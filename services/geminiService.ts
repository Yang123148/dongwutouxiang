import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function analyzeStyle(base64Image: string): Promise<string> {
  try {
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64,
            },
          },
          {
            text: "You are a fun, trendy fashion stylist. A user has placed virtual stickers (clothes, hats, glasses) on their camera feed. 1) Briefly describe the look. 2) Give a rating out of 10. 3) Provide a short, witty, or encouraging comment about their style. Keep it under 50 words.",
          },
        ],
      },
    });

    return response.text || "You look great! (Couldn't generate specific advice right now).";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Oops! My fashion sense is offline right now. Try again later!";
  }
}