import { useState, useEffect, useCallback, useRef } from 'react';

interface SpeechRecognitionHookProps {
    onTranscription: (text: string, accumulated: string) => void;
    onSilenceDetected: (finalText: string) => void;
    silenceThresholdMs?: number;
}

export function useSpeechRecognition({
    onTranscription,
    onSilenceDetected,
    silenceThresholdMs = 2000
}: SpeechRecognitionHookProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<any>(null);
    const accumulatedTextRef = useRef('');
    const currentInterimRef = useRef('');
    const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Initialize speech recognition
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
            
            if (!SpeechRecognition) {
                setError('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
                return;
            }

            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }

                if (finalTranscript) {
                    accumulatedTextRef.current += (accumulatedTextRef.current ? ' ' : '') + finalTranscript;
                }
                
                currentInterimRef.current = interimTranscript;
                onTranscription(interimTranscript, accumulatedTextRef.current);

                // Reset silence timer on any word
                if (silenceTimeoutRef.current) {
                    clearTimeout(silenceTimeoutRef.current);
                }

                // Only trigger silence action if we have some final text accumulated
                silenceTimeoutRef.current = setTimeout(() => {
                    const sendText = accumulatedTextRef.current.trim();
                    if (sendText) {
                        onSilenceDetected(sendText);
                        accumulatedTextRef.current = '';
                        onTranscription('', '');
                    }
                }, silenceThresholdMs);
            };

            recognition.onerror = (event: any) => {
                console.error('Speech recognition error:', event.error);
                if (event.error !== 'no-speech') {
                    setError(`Error: ${event.error}`);
                    setIsRecording(false);
                }
            };

            recognition.onend = () => {
                // If it ends abruptly but we're still 'recording', auto-restart
                if (isRecording) {
                    try {
                        recognition.start();
                    } catch (e) {
                        console.error('Failed to restart recognition:', e);
                    }
                } else {
                    setIsRecording(false);
                }
            };

            recognitionRef.current = recognition;
        }

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            if (silenceTimeoutRef.current) {
                clearTimeout(silenceTimeoutRef.current);
            }
        };
    }, [onTranscription, onSilenceDetected, isRecording, silenceThresholdMs]);

    const startRecording = useCallback(() => {
        setError(null);
        accumulatedTextRef.current = '';
        currentInterimRef.current = '';
        onTranscription('', '');
        
        if (recognitionRef.current) {
            try {
                recognitionRef.current.start();
                setIsRecording(true);
            } catch (err: any) {
                console.error('Failed to start recognition:', err);
                // If it's already started, just set state true
                if (err.name === 'InvalidStateError') {
                    setIsRecording(true);
                } else {
                    setError('Could not start microphone.');
                }
            }
        } else {
            setError('Speech recognition not available.');
        }
    }, [onTranscription]);

    const stopRecording = useCallback(() => {
        setIsRecording(false);
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
        if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
        }
        
        // Final flush
        const sendText = accumulatedTextRef.current.trim();
        if (sendText) {
            onSilenceDetected(sendText);
            accumulatedTextRef.current = '';
            onTranscription('', '');
        }
    }, [onSilenceDetected, onTranscription]);

    const pauseRecording = useCallback(() => {
        // Pausing is basically stopping in SpeechRecognition semantics
        // since we auto-restart on 'end' only if isRecording is true
        setIsRecording(false);
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
    }, []);

    const resumeRecording = useCallback(() => {
        startRecording();
    }, [startRecording]);

    return {
        isRecording,
        isPaused: !isRecording,
        error,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        isCapturingSystemAudio: false
    };
}
