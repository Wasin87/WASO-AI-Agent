
import { GoogleGenAI } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contents, systemInstruction, isImage } = req.body;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    
    if (isImage) {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents,
        config: { imageConfig: { aspectRatio: "1:1" } }
      });
      
      const parts = response.candidates?.[0]?.content?.parts || [];
      return res.status(200).json({ parts });
    } else {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents,
        config: { systemInstruction }
      });
      
      return res.status(200).json({ text: response.text });
    }
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
