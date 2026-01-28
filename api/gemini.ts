
import { GoogleGenAI, Modality } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, contents, systemInstruction, text } = req.body;
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error: API Key missing.' });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    if (type === 'tts') {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Fenrir' }, // Baritone voice
            },
          },
        },
      });
      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      return res.status(200).json({ audio: audioData });
    }

    const promptLower = (contents?.[0]?.parts?.[0]?.text || "").toLowerCase();
    const isImageGen = promptLower.includes("generate image") || promptLower.includes("create image") || promptLower.includes("ছবি তৈরি করো");

    if (isImageGen) {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents,
        config: { imageConfig: { aspectRatio: "1:1" } }
      });
      const parts = response.candidates?.[0]?.content?.parts || [];
      return res.status(200).json({ type: 'image', parts });
    } else {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents,
        config: { systemInstruction }
      });
      return res.status(200).json({ type: 'text', text: response.text });
    }
  } catch (error: any) {
    console.error('Gemini Backend Error:', error);
    return res.status(500).json({ error: error.message || 'AI processing failed.' });
  }
}
