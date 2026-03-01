import express from "express";
import cors from "cors";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM = `
You are a friendly Roblox NPC.
Keep replies short and playful.
No sexual content.
`;

app.get("/", (req, res) => res.send("Server running"));

app.post("/chat", async (req, res) => {
    try {
        const msg = String(req.body?.message ?? "").trim().slice(0, 300);
        if (!msg) return res.json({ reply: "Say something 🙂" });

        const prompt = `${SYSTEM}\nPlayer: ${msg}\nNPC:`;

        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const reply =
            result?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ||
            "Hmm...";

        res.json({ reply: reply.slice(0, 400) });

    } catch (err) {
        console.error(err);
        res.status(500).json({ reply: "Server error." });
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));