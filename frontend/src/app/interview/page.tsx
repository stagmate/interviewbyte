'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useProfile } from '@/contexts/ProfileContext';
import { AudioLevelIndicator } from '@/components/interview/AudioLevelIndicator';
import { TranscriptionDisplay } from '@/components/interview/TranscriptionDisplay';
import { AnswerDisplay } from '@/components/interview/AnswerDisplay';
import { RecordingControls } from '@/components/interview/RecordingControls';

interface Answer {
    question: string;
    answer: string;
    timestamp: Date;
    source?: string;
    hasPlaceholder?: boolean;
}

interface StarStory {
    id: string;
    title: string;
    situation: string;
    task: string;
    action: string;
    result: string;
    tags: string[];
}

interface QAPair {
    id: string;
    question: string;
    answer: string;
    question_type: string;
    source: string;
    usage_count: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function PracticePage() {
    const router = useRouter();

    // Context from active profile (if user has one, otherwise works without it)
    const { activeProfile, isLoading: profileLoading } = useProfile();

    const [currentText, setCurrentText] = useState('');
    const [accumulatedText, setAccumulatedText] = useState('');
    const [answers, setAnswers] = useState<Answer[]>([]);
    const [streamingAnswer, setStreamingAnswer] = useState<string>('');
    const [streamingQuestion, setStreamingQuestion] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [sessionTime, setSessionTime] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [starStories, setStarStories] = useState<StarStory[]>([]);
    const [qaPairs, setQaPairs] = useState<QAPair[]>([]);
    const [processingState, setProcessingState] = useState<'idle' | 'generating'>('idle');
    const [feedbackGiven, setFeedbackGiven] = useState<1 | -1 | null>(null);

    // Fetch user context if profile exists
    useEffect(() => {
        if (!activeProfile) return;

        const fetchAll = async () => {
            try {
                // Fetch Q&A pairs (assuming user is anonymous, skip complex backend auth)
                // However, without backend we just leave it empty if API fails
                if (!activeProfile.user_id) return;
                
                const contextUrl = new URL(`${API_URL}/api/profile/context/${activeProfile.user_id}`);
                contextUrl.searchParams.set('profile_id', activeProfile.id);

                const qaPairsUrl = new URL(`${API_URL}/api/qa-pairs/${activeProfile.user_id}`);
                qaPairsUrl.searchParams.set('profile_id', activeProfile.id);

                const [contextResponse, qaPairsResponse] = await Promise.all([
                    fetch(contextUrl.toString()).catch(() => null),
                    fetch(qaPairsUrl.toString()).catch(() => null)
                ]);

                if (contextResponse?.ok) {
                    const contextData = await contextResponse.json();
                    setStarStories(contextData.star_stories || []);
                }

                if (qaPairsResponse?.ok) {
                    const qaPairsData = await qaPairsResponse.json();
                    setQaPairs(qaPairsData || []);
                }
            } catch (err) {
                console.error('Failed to fetch user context:', err);
            }
        };

        fetchAll();
    }, [activeProfile]);

    const requestAnswer = useCallback(async (questionText: string) => {
        if (!questionText.trim()) return;

        setIsGenerating(true);
        setProcessingState('generating');
        setStreamingQuestion(questionText);
        setStreamingAnswer('');

        try {
            const contextData: string[] = [];
            if (activeProfile?.projects_summary) contextData.push(`Projects: ${activeProfile.projects_summary}`);
            if (starStories.length > 0) contextData.push(`Stories: ${JSON.stringify(starStories.map(s => ({ title: s.title, situation: s.situation, action: s.action })))}`);
            if (qaPairs.length > 0) contextData.push(`Prepared Q&A: ${JSON.stringify(qaPairs.map(q => ({ q: q.question, a: q.answer })))}`);

            const response = await fetch('/api/generate-answer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: questionText,
                    contexts: contextData
                })
            });

            if (!response.ok) {
                throw new Error('Failed to reach Gemini API.');
            }

            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let fullAnswer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                fullAnswer += chunk;
                setStreamingAnswer(prev => prev + chunk);
            }

            // Finalize Answer
            setAnswers(prev => [{
                question: questionText,
                answer: fullAnswer,
                timestamp: new Date(),
                source: 'gemini',
                hasPlaceholder: false
            }, ...prev]);

        } catch (err: any) {
            setError(err.message || 'Failed to generate answer.');
        } finally {
            setIsGenerating(false);
            setProcessingState('idle');
            setStreamingAnswer('');
            setStreamingQuestion('');
        }
    }, [activeProfile, starStories, qaPairs]);

    // Handle Native Speech Recognition
    const handleTranscription = useCallback((text: string, accumulated: string) => {
        setCurrentText(text);
        setAccumulatedText(accumulated);
    }, []);

    const handleSilenceDetected = useCallback((finalText: string) => {
        console.log('Silence detected, finalizing text:', finalText);
        // Automatically ask AI!
        if (finalText.trim()) {
            requestAnswer(finalText);
        }
    }, [requestAnswer]);

    const {
        isRecording,
        isPaused,
        error: recordingError,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
    } = useSpeechRecognition({
        onTranscription: handleTranscription,
        onSilenceDetected: handleSilenceDetected,
        silenceThresholdMs: 1500
    });

    // Session timer
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        if (isRecording && !isPaused) {
            interval = setInterval(() => {
                setSessionTime(prev => prev + 1);
            }, 1000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isRecording, isPaused]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleClear = () => {
        stopRecording();
        setCurrentText('');
        setAccumulatedText('');
        setAnswers([]);
        setSessionTime(0);
        setError(null);
    };

    const handleManualGenerate = useCallback(() => {
        if (accumulatedText.trim()) {
            requestAnswer(accumulatedText);
            setAccumulatedText('');
            setCurrentText('');
        }
    }, [accumulatedText, requestAnswer]);

    const handleRegenerate = useCallback((question: string) => {
        requestAnswer(question);
    }, [requestAnswer]);

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-black">
            {/* Header */}
            <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
                    <div>
                        {activeProfile && (
                            <div className="mb-1 flex items-center gap-2">
                                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-bold text-white">
                                    {activeProfile.profile_name.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                    {activeProfile.profile_name}
                                </span>
                            </div>
                        )}
                        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                            Interview Practice (Native Speech)
                        </h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-2xl font-mono text-zinc-700 dark:text-zinc-300">
                            {formatTime(sessionTime)}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full ${isRecording ? 'bg-green-500' : 'bg-red-500'}`}/>
                            <span className="text-sm text-zinc-500 dark:text-zinc-400">
                                {isRecording ? 'Listening' : 'Ready'}
                            </span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl px-4 py-6">
                {(error || recordingError) && (
                    <div className="mb-4 rounded-lg bg-red-50 p-4 text-red-700 dark:bg-red-950 dark:text-red-300">
                        {error || recordingError}
                    </div>
                )}

                <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="mb-4">
                        <RecordingControls
                            isRecording={isRecording}
                            isPaused={isPaused}
                            isConnected={true} // Bypassing websocket requirement
                            disabled={false}
                            captureSystemAudio={false}
                            isCapturingSystemAudio={false}
                            onCaptureSystemAudioChange={() => {}}
                            onStart={startRecording}
                            onStop={stopRecording}
                            onPause={pauseRecording}
                            onResume={resumeRecording}
                            onClear={handleClear}
                        />
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                            Audio Level:
                        </span>
                        <AudioLevelIndicator level={isRecording && !isPaused ? 50 : 0} isRecording={isRecording} />
                    </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                        <TranscriptionDisplay
                            currentText={currentText}
                            accumulatedText={accumulatedText}
                            isProcessing={isRecording}
                            processingState={processingState}
                            onGenerateAnswer={handleManualGenerate}
                            canGenerate={!isGenerating && accumulatedText.length > 0}
                        />
                    </div>

                    <div>
                        <AnswerDisplay
                            answers={answers}
                            isGenerating={isGenerating}
                            temporaryAnswer={null}
                            streamingAnswer={streamingAnswer}
                            streamingQuestion={streamingQuestion}
                            onRegenerate={handleRegenerate}
                            onStopGenerating={() => setIsGenerating(false)}
                        />
                    </div>
                </div>
                
                {/* Instructions */}
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
                    <h3 className="mb-2 font-medium text-blue-900 dark:text-blue-100">
                        How to use (Gemini Native Integration)
                    </h3>
                    <ol className="list-inside list-decimal space-y-2 text-sm text-blue-800 dark:text-blue-200">
                        <li><strong>Start Recording</strong> - The browser will securely listen to your microphone natively.</li>
                        <li><strong>Speak your question</strong> - Wait ~1.5 seconds when finished speaking.</li>
                        <li><strong>Auto-Generate</strong> - The app will automatically transcribe your voice and ask your Gemini API for an answer!</li>
                    </ol>
                </div>
            </main>
        </div>
    );
}