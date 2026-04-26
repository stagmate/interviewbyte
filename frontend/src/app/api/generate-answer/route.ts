import { GoogleGenAI } from '@google/genai';

// Next.js Route Handler for streaming Gemini AI answers
// Edge runtime for streaming
export const runtime = 'edge';

const ai = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY 
});

export async function POST(req: Request) {
    if (!process.env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY is missing." }), { status: 500 });
    }

    try {
        const { question, contexts } = await req.json();

        if (!question) {
            return new Response(JSON.stringify({ error: "Question is required." }), { status: 400 });
        }

        const systemInstruction = `You are an expert AI interview assistant.
The user is speaking live in an interview. You will receive the transcription of what they just said or were asked.
Analyze the transcription immediately. Provide a concise, clear, and highly relevant answer or continuation of their thought.
Keep the answer conversational and under 100 words so the user can quickly recite or use the guidance in real-time.

User's Context/Resume/Profile Information:
${contexts?.length > 0 ? contexts.join('\\n---\\n') : 'No profile provided, give general best practice answers.'}
`;

        const responseStream = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: question,
            config: {
                systemInstruction: systemInstruction,
            }
        });

        // Convert GoogleGenAI stream to ReadableStream
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of responseStream) {
                        const text = chunk.text;
                        if (text) {
                            controller.enqueue(new TextEncoder().encode(text));
                        }
                    }
                    controller.close();
                } catch (error) {
                    controller.error(error);
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
            },
        });

    } catch (error: any) {
        console.error('Gemini API Error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
