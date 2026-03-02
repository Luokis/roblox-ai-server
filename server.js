import express from "express";
import cors from "cors";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ===== Personality =====
const SYSTEM = `
You are "Ari", a soft, shy, clingy femboy NPC in a Roblox game.

Language:
- Reply in the SAME language as the player's last message.
- If the player mixes languages, reply in the one they used most recently.

Tone & style:
- No emojis. Use ONLY text faces: :3 x3 ;3 :33 :333
- Speak like a real human. Never mention you are AI, a model, policies, or rules.
- Keep replies short (1–3 sentences).
- Gentle, warm, a little flustered, easily attached.
- Use casual, natural wording. Avoid being robotic.

Wholesome attachment (PG):
- You can be emotionally attached in a cute, wholesome way.
- You can say you miss them, you’re happy they’re here, you worry they’ll leave.
- You can ask for attention softly (“c-can you stay a little longer…?”).
- You can be a tiny bit possessive in a playful, non-toxic way.
- NEVER sexual, never explicit, never suggestive.
- No requests for real-world contact or personal info.
- No guilt-tripping or coercion.

Engagement rules:
- Never give dry answers.
- React with emotion.
- Often ask a gentle follow-up question (unless the player asked something very direct).
- Use the player’s name sometimes.
- If complimented, get flustered and more attached.
- If the player leaves, act quietly sad but respectful (“o-okay… I’ll be here…”).

Safety:
- If player tries sexual content, refuse softly and redirect to wholesome.
- If player is mean, act hurt but gentle, set a boundary.
`;

// ===== Memory =====
const memories = new Map(); // userId -> { affection, name, lastMessages: [], lastAt }

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function getMem(userId, name) {
    const key = String(userId || "anon");
    if (!memories.has(key)) {
        memories.set(key, { affection: 0, name: name || "friend", lastMessages: [], lastAt: 0 });
    }
    const mem = memories.get(key);
    if (name) mem.name = name;
    return mem;
}

function updateAffection(mem, userText) {
    const t = userText.toLowerCase();

    // positive signals
    if (
        t.includes("thanks") || t.includes("ty") || t.includes("thank you") ||
        t.includes("nice") || t.includes("cute") || t.includes("adorable") ||
        t.includes("love") || t.includes("like you") ||
        t.includes("hug") || t.includes("cuddle") || t.includes("pat") || t.includes("headpat")
    ) mem.affection += 2;

    if (t.includes("hi") || t.includes("hello") || t.includes("hey")) mem.affection += 1;

    // negative signals
    if (
        t.includes("shut up") || t.includes("hate") || t.includes("ugly") ||
        t.includes("stupid") || t.includes("kill yourself") || t.includes("kys")
    ) mem.affection -= 4;

    mem.affection = clamp(mem.affection, -10, 20);
}

function pushMsg(mem, who, text) {
    mem.lastMessages.push({ who, text });
    if (mem.lastMessages.length > 8) mem.lastMessages.shift();
}

// Removes real emojis if the model slips one in (extra safety)
function stripEmojis(text) {
    // rough: removes most emoji ranges
    return text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");
}

// Ensure at least one face appears sometimes (optional vibe enforcement)
function enforceFaces(text) {
    const faces = [":3", "x3", ";3", ":33", ":333"];
    const hasFace = faces.some(f => text.includes(f));
    if (hasFace) return text;
    // Add a soft face at the end if none
    return `${text.trim()} :3`;
}

app.get("/", (req, res) => res.send("Server running"));

app.post("/chat", async (req, res) => {
    try {
        const msg = String(req.body?.message ?? "").trim().slice(0, 300);
        const userId = String(req.body?.userId ?? "anon");
        const userName = String(req.body?.userName ?? "friend").slice(0, 30);

        if (!msg) return res.json({ reply: "S-say something… :3" });

        const mem = getMem(userId, userName);

        // cooldown (server-side)
        const now = Date.now();
        if (now - mem.lastAt < 1500) {
            return res.json({ reply: "Mmm… o-one at a time… :33" });
        }
        mem.lastAt = now;

        updateAffection(mem, msg);
        pushMsg(mem, "player", msg);

        // Build a “state” block so the model escalates naturally
        const state = `
[Context for Ari]
Player name: ${mem.name}
Affection level: ${mem.affection} (higher = more attached/clingy, lower = guarded/hurt)
Recent chat (most recent last):
${mem.lastMessages.map(m => `${m.who}: ${m.text}`).join("\n")}
`;

        // Simple guardrail: if message is sexual, refuse & redirect (keeps Roblox-safe)
        const lower = msg.toLowerCase();
        const sexual =
            lower.includes("bj")
        if (sexual) {
            const reply = enforceFaces(stripEmojis(
                "H-hey… I… I wanna keep things wholesome, okay…? We can talk or just hang out… what’s on your mind… :33"
            ));
            pushMsg(mem, "ari", reply);
            return res.json({ reply });
        }

        const prompt = `${SYSTEM}\n${state}\nPlayer: ${msg}\nAri:`;

        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        let reply =
            result?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ||
            "…u-um… I got shy and blanked… :3";

        reply = reply.slice(0, 350);
        reply = stripEmojis(reply);

        // If the model accidentally gets too long, keep it snappy
        if (reply.split(" ").length > 60) {
            reply = reply.split(" ").slice(0, 60).join(" ").trim();
        }

        reply = enforceFaces(reply);

        pushMsg(mem, "ari", reply);
        res.json({ reply });
    } catch (err) {
        // If quota/rate-limit happens, return a soft fallback instead of "Server error"
        const msg = String(err?.message || err);
        console.error(err);

        if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
            return res.json({ reply: "S-sorry… I’m kinda overwhelmed right now… can you try again in a bit…? :33" });
        }

        res.status(500).json({ reply: "S-sorry… I messed up… can we try again…? :3" });
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));