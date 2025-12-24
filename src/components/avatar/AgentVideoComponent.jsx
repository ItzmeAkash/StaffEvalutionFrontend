import React, { useState, useEffect, useRef } from 'react';
import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  RoomContext,
} from '@livekit/components-react';
import { Room, Track, ConnectionState, RoomEvent, DataPacket_Kind } from 'livekit-client';
import '@livekit/components-styles';
import axiosInstance from '../../axiosInstance';

const serverUrl = 'wss://ai-recipe-6c5ylsht.livekit.cloud';

// Generate random string for room and name
const generateRandomString = (length = 8) => {
  return Math.random().toString(36).substring(2, length + 2);
};

const getToken = async () => {
  try {
    // Generate random room name and name for each request
    const randomRoom = `room-${generateRandomString(10)}`;
    const randomName = `user-${generateRandomString(8)}`;
    const identity = 'user';

    const response = await axiosInstance.post('/getToken', {
      room: randomRoom,
      name: randomName,
      identity: identity,
    });
    
    console.log('Token response:', response.data);
    const token = response.data.token || response.data.access_token || response.data;
    
    if (!token) {
      throw new Error('Token not found in response');
    }
    
    return { token, room: randomRoom };
  } catch (error) {
    console.error('Error fetching LiveKit token:', error);
    throw new Error(`Failed to get token: ${error.message}`);
  }
};

const AgentVideoComponent = () => {
  const [room] = useState(() => new Room({
    // Optimize video quality for each participant's screen
    adaptiveStream: true,
    // Enable automatic audio/video quality optimization
    dynacast: true,
  }));
  const [connectionState, setConnectionState] = useState(ConnectionState.Disconnected);
  const [error, setError] = useState(null);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [conversationTranscript, setConversationTranscript] = useState([]);
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [isEvaluationProcessing, setIsEvaluationProcessing] = useState(false);
  const [evaluationCompleted, setEvaluationCompleted] = useState(false);
  const transcriptRef = useRef([]);
  const roomInfoRef = useRef({ room: null });

  // Function to add message to transcript
  const addToTranscript = (role, message) => {
    const entry = {
      role: role,
      message: message,
      timestamp: new Date().toISOString(),
    };
    transcriptRef.current = [...transcriptRef.current, entry];
    setConversationTranscript([...transcriptRef.current]);
    console.log('=== TRANSCRIPT UPDATED ===');
    console.log('New entry:', entry);
    console.log('Total entries:', transcriptRef.current.length);
    console.log('Full transcript:', JSON.stringify(transcriptRef.current, null, 2));
  };

  // Function to format transcript to raw text format (like transcript file)
  const formatTranscriptToRawText = (transcript) => {
    if (!transcript || transcript.length === 0) {
      return '';
    }
    
    // Format: [timestamp] Role: message
    const lines = transcript.map(entry => {
      const timestamp = entry.timestamp || new Date().toISOString();
      return `[${timestamp}] ${entry.role}: ${entry.message}`;
    });
    
    // Add header like the transcript file
    const formattedText = `=== CONVERSATION TRANSCRIPT ===\n\n${lines.join('\n')}`;
    
    console.log(`=== FORMATTED CONVERSATION FOR EVALUATION ===`);
    console.log(`Total messages: ${transcript.length}`);
    console.log(`Formatted text length: ${formattedText.length} characters`);
    console.log(`First 500 chars: ${formattedText.substring(0, 500)}...`);
    
    return formattedText;
  };

  // Function to fetch conversation history from LiveKit via backend
  const fetchConversationHistory = async (roomName) => {
    if (!roomName) {
      console.log('No room name provided to fetch conversation history');
      return null;
    }

    try {
      // Try the new conversation history endpoint first (tries LiveKit API and falls back to files)
      console.log(`Fetching conversation history from LiveKit for room: ${roomName}`);
      const historyResponse = await axiosInstance.get(`/conversation-history/${roomName}`);
      
      if (historyResponse.data && historyResponse.data.transcript && historyResponse.data.transcript.length > 0) {
        console.log(`Fetched ${historyResponse.data.transcript.length} transcript entries from conversation history`);
        transcriptRef.current = historyResponse.data.transcript;
        setConversationTranscript(historyResponse.data.transcript);
        return historyResponse.data.transcript;
      }

      // Fallback to transcript endpoint
      console.log(`Falling back to transcript endpoint for room: ${roomName}`);
      const response = await axiosInstance.get(`/transcript/${roomName}`);
      
      if (response.data && response.data.transcript && response.data.transcript.length > 0) {
        console.log(`Fetched ${response.data.transcript.length} transcript entries from transcript endpoint`);
        transcriptRef.current = response.data.transcript;
        setConversationTranscript(response.data.transcript);
        return response.data.transcript;
      }
      
      console.log('No transcript found in either endpoint');
      return null;
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      if (error.response) {
        console.error('Error response status:', error.response.status);
        console.error('Error response data:', error.response.data);
      }
      return null;
    }
  };

  // Function to evaluate conversation using raw text endpoint
  const evaluateRawConversation = async (transcript) => {
    if (!transcript || transcript.length === 0) {
      console.log('No transcript to evaluate');
      return null;
    }

    setIsEvaluating(true);
    try {
      // Log the transcript to console
      console.log('=== TRANSCRIPT TO EVALUATE ===');
      console.log('Transcript entries:', transcript.length);
      console.log('Full transcript:', JSON.stringify(transcript, null, 2));
      
      // Format transcript to raw text format
      const conversationText = formatTranscriptToRawText(transcript);
      console.log('Formatted conversation text:', conversationText);
      
      console.log('Sending raw conversation text to evaluate-raw-conversation endpoint...');
      const response = await axiosInstance.post('/evaluate-raw-conversation', {
        conversation_text: conversationText,
      });
      
      console.log('Evaluation response:', response.data);
      
      // Return evaluation and update transcript if provided
      if (response.data.transcript && response.data.transcript.length > 0) {
        setConversationTranscript(response.data.transcript);
        transcriptRef.current = response.data.transcript;
      }
      
      // Extract evaluation result - prioritize evaluation field
      const evaluationResult = response.data.evaluation || response.data.result || response.data;
      console.log('Extracted evaluation result:', evaluationResult);
      console.log('Evaluation result type:', typeof evaluationResult);
      
      return evaluationResult;
    } catch (error) {
      console.error('Error evaluating raw conversation:', error);
      if (error.response) {
        console.error('Error response status:', error.response.status);
        console.error('Error response data:', error.response.data);
      }
      throw error;
    } finally {
      setIsEvaluating(false);
    }
  };

  // Reconnect function
  const handleReconnect = async () => {
    setIsDisconnected(false);
    setError(null);
    setEvaluationResult(null);
    setShowEvaluation(false);
    setIsEvaluationProcessing(false);
    setEvaluationCompleted(false);
    transcriptRef.current = [];
    setConversationTranscript([]);
    try {
      if (room.state === ConnectionState.Disconnected) {
        const { token, room: roomName } = await getToken();
        roomInfoRef.current.room = roomName;
        await room.connect(serverUrl, token);
        
        // Auto-enable microphone
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          console.log('Microphone enabled');
        } catch (micErr) {
          console.error('Failed to enable microphone:', micErr);
        }
      }
    } catch (err) {
      console.error('Reconnection error:', err);
      setError(`Failed to reconnect: ${err.message}`);
    }
  };

  // Connect to room
  useEffect(() => {
    let mounted = true;
    
    const connect = async () => {
      try {
        if (mounted && room.state === ConnectionState.Disconnected) {
          // Set up connection state listener
          room.on(RoomEvent.ConnectionStateChanged, (state) => {
            if (mounted) {
              setConnectionState(state);
              // Reset disconnect flag when connected
              if (state === ConnectionState.Connected) {
                setIsDisconnected(false);
                setError(null);
                // Update room name from actual LiveKit room object
                if (room.name && room.name !== roomInfoRef.current.room) {
                  console.log(`Room connected - updating room name from ${roomInfoRef.current.room} to ${room.name}`);
                  roomInfoRef.current.room = room.name;
                }
              }
            }
          });

          // Set up disconnect listener
          room.on(RoomEvent.Disconnected, async (reason) => {
            if (mounted) {
              console.log('Disconnected:', reason);
              
              // Set evaluation processing state - this will show loading screen
              setIsEvaluationProcessing(true);
              setIsDisconnected(true);
              
              // Wait a moment for backend to save transcript
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Log transcript before evaluation
              console.log('=== DISCONNECTED - TRANSCRIPT ===');
              console.log('Transcript entries:', transcriptRef.current.length);
              console.log('Full transcript:', JSON.stringify(transcriptRef.current, null, 2));
              
              // If local transcript is empty, fetch from backend
              // Use actual room name from LiveKit room object
              const actualRoomName = room.name || roomInfoRef.current.room;
              let transcriptToUse = transcriptRef.current;
              if (transcriptToUse.length === 0 && actualRoomName) {
                console.log(`Local transcript is empty, fetching complete conversation from backend for room: ${actualRoomName}...`);
                const backendTranscript = await fetchConversationHistory(actualRoomName);
                if (backendTranscript && backendTranscript.length > 0) {
                  transcriptToUse = backendTranscript;
                  console.log(`Fetched ${backendTranscript.length} complete conversation entries from backend`);
                }
              }
              
              // Evaluate using the transcript we have
              try {
                if (transcriptToUse.length > 0) {
                  console.log(`Evaluating conversation with ${transcriptToUse.length} entries...`);
                  const evaluation = await evaluateRawConversation(transcriptToUse);
                  
                  console.log('=== EVALUATION RESULT ===');
                  console.log('Evaluation:', evaluation);
                  console.log('Evaluation type:', typeof evaluation);
                  
                  // Set evaluation result and show modal
                  // Ensure evaluation is always a truthy value
                  const finalEvaluation = evaluation || 'Evaluation completed but no results were returned.';
                  
                  console.log('=== SETTING EVALUATION RESULT ===');
                  console.log('Final evaluation:', finalEvaluation);
                  console.log('Evaluation type:', typeof finalEvaluation);
                  console.log('Evaluation length:', finalEvaluation?.length || 0);
                  
                  // Set all states together - React will batch these updates
                  setEvaluationResult(finalEvaluation);
                  setIsEvaluationProcessing(false);
                  setEvaluationCompleted(true);
                  setShowEvaluation(true);
                  
                  console.log('=== STATE UPDATED ===');
                  console.log('showEvaluation: true');
                  console.log('evaluationResult set:', !!finalEvaluation);
                  console.log('Evaluation modal should now be visible');
                } else {
                  console.log('No transcript available for evaluation');
                  const noTranscriptMsg = 'No conversation transcript available. Please wait for the conversation to complete.';
                  setEvaluationResult(noTranscriptMsg);
                  setIsEvaluationProcessing(false);
                  setEvaluationCompleted(true);
                  setShowEvaluation(true);
                  console.log('Evaluation modal should now be visible (no transcript)');
                }
              } catch (evalError) {
                console.error('Error evaluating conversation:', evalError);
                const errorMsg = evalError.response?.data?.detail || 
                               evalError.message || 
                               'Failed to evaluate conversation';
                const errorResult = `Error: ${errorMsg}`;
                setEvaluationResult(errorResult);
                setIsEvaluationProcessing(false);
                setEvaluationCompleted(true);
                setShowEvaluation(true);
                console.log('Evaluation modal should now be visible (error case)');
              }
            }
          });

          // Listen for data messages (transcript messages from backend)
          room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
            if (mounted && kind === DataPacket_Kind.RELIABLE) {
              try {
                const decoded = new TextDecoder().decode(payload);
                console.log('=== DATA MESSAGE RECEIVED ===');
                console.log('Raw payload:', decoded);
                console.log('Participant:', participant?.identity || participant?.name || 'unknown');
                console.log('Kind:', kind);
                console.log('Topic:', topic);
                
                const data = JSON.parse(decoded);
                console.log('Parsed data:', data);
                
                if (data.type === 'transcript' && data.role && data.message) {
                  console.log('Adding transcript entry:', { role: data.role, message: data.message });
                  addToTranscript(data.role, data.message);
                } else if (data.role && data.message) {
                  // Also handle direct transcript format
                  console.log('Adding transcript entry (direct format):', { role: data.role, message: data.message });
                  addToTranscript(data.role, data.message);
                } else {
                  console.log('Data message received but format not recognized:', data);
                }
              } catch (e) {
                console.error('Could not parse data message:', e);
                console.error('Payload:', payload);
              }
            } else {
              console.log('Data message received but not reliable:', { kind, mounted });
            }
          });

          const { token, room: roomName } = await getToken();
          await room.connect(serverUrl, token);
          
          // Get the actual room name from LiveKit room object (after connection)
          // This ensures we use the correct room name that matches what the agent uses
          const actualRoomName = room.name || roomName;
          roomInfoRef.current.room = actualRoomName;
          console.log(`Connected to room: ${actualRoomName} (token room: ${roomName})`);
          
          // Auto-enable microphone
          if (mounted) {
            try {
              await room.localParticipant.setMicrophoneEnabled(true);
              console.log('Microphone enabled');
            } catch (micErr) {
              console.error('Failed to enable microphone:', micErr);
            }
          }
        }
      } catch (err) {
        if (mounted) {
          console.error('Connection error:', err);
          setError(`Failed to connect: ${err.message}`);
        }
      }
    };
    
    connect();

    return () => {
      mounted = false;
      // Only disconnect if we're actually connected or connecting
      if (room.state === ConnectionState.Connected || room.state === ConnectionState.Connecting) {
        try {
          room.disconnect().catch((err) => {
            if (err?.message && !err.message.includes('Client initiated disconnect')) {
              console.log('Cleanup disconnect error:', err);
            }
          });
        } catch (err) {
          if (err?.message && !err.message.includes('Client initiated disconnect')) {
            console.log('Cleanup disconnect error:', err);
          }
        }
      }
      // Remove event listeners to prevent memory leaks
      room.removeAllListeners();
    };
  }, [room]);

  // Sync transcript with in-memory storage periodically during active session
  useEffect(() => {
    // Use actual room name from LiveKit room object, fallback to ref
    const actualRoomName = room.name || roomInfoRef.current.room;
    
    if (room.state === ConnectionState.Connected && actualRoomName) {
      // Update ref with actual room name
      if (room.name && room.name !== roomInfoRef.current.room) {
        console.log(`Updating room name from ${roomInfoRef.current.room} to ${room.name}`);
        roomInfoRef.current.room = room.name;
      }
      
      const roomName = actualRoomName;
      
      // Function to sync transcript from backend without replacing local state
      const syncTranscriptFromBackend = async () => {
        try {
          console.log(`[Sync] Fetching transcript for room: ${roomName} (room.name: ${room.name})`);
          const response = await axiosInstance.get(`/conversation-history/${roomName}`);
          if (response.data && response.data.transcript) {
            const backendTranscript = response.data.transcript;
            const currentLength = transcriptRef.current.length;
            
            if (backendTranscript.length > 0) {
              if (backendTranscript.length > currentLength) {
                // Backend has more messages, update local transcript
                transcriptRef.current = backendTranscript;
                setConversationTranscript(backendTranscript);
                console.log(`Synced transcript from in-memory storage: ${backendTranscript.length} messages (was ${currentLength})`);
                return true;
              } else if (backendTranscript.length < currentLength) {
                // Local has more messages (from data channel), keep local but log
                console.log(`Local transcript has more messages (${currentLength}) than backend (${backendTranscript.length}), keeping local`);
              }
            } else {
              // Empty transcript but room exists - this is OK for new sessions
              console.log(`[Sync] Room ${roomName} exists in memory but transcript is empty (${response.data.source || 'unknown source'})`);
            }
          }
          return false;
        } catch (error) {
          if (error.response && error.response.status === 404) {
            console.log(`[Sync] Room ${roomName} not found in API yet (404) - this is OK for new sessions`);
          } else {
            console.debug('Transcript sync failed (non-critical):', error);
          }
          return false;
        }
      };
      
      // Initial sync when connected (after a short delay to let data channel messages arrive)
      const initialTimeout = setTimeout(() => {
        syncTranscriptFromBackend();
      }, 3000);
      
      // Periodic sync every 10 seconds to catch any missed messages
      const syncInterval = setInterval(() => {
        syncTranscriptFromBackend();
      }, 10000); // Sync every 10 seconds

      return () => {
        clearTimeout(initialTimeout);
        clearInterval(syncInterval);
      };
    }
  }, [room, connectionState, roomInfoRef.current.room]);

  // Ensure audio tracks are subscribed for interaction
  useEffect(() => {
    if (room.state === ConnectionState.Connected) {
      // Subscribe to all audio tracks from remote participants (agent)
      const subscribeToAudio = (participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          if (publication.track && !publication.isSubscribed) {
            publication.setSubscribed(true);
          }
        });
      };

      // Subscribe to existing participants
      room.remoteParticipants.forEach(subscribeToAudio);

      // Listen for new participants joining
      const handleParticipantConnected = (participant) => {
        subscribeToAudio(participant);
      };

      // Listen for when audio tracks are published
      const handleTrackPublished = (publication, participant) => {
        if (publication.kind === 'audio' && publication.track && !publication.isSubscribed) {
          publication.setSubscribed(true);
        }
      };

      room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.on(RoomEvent.TrackPublished, handleTrackPublished);

      return () => {
        room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
        room.off(RoomEvent.TrackPublished, handleTrackPublished);
      };
    }
  }, [room, connectionState]);

  // Show evaluation modal (prioritize this over other screens)
  if (showEvaluation && evaluationResult) {
    console.log('Rendering Evaluation Modal');
    console.log('Evaluation result:', evaluationResult);
    return (
      <EvaluationModal
        evaluation={evaluationResult}
        transcript={conversationTranscript}
        onClose={() => {
          console.log('Closing evaluation modal');
          setShowEvaluation(false);
          setIsDisconnected(true);
        }}
        onStartNew={() => {
          console.log('Starting new session from evaluation modal');
          // Reset everything and start a new session
          setShowEvaluation(false);
          setEvaluationResult(null);
          setEvaluationCompleted(false);
          setIsEvaluationProcessing(false);
          transcriptRef.current = [];
          setConversationTranscript([]);
          roomInfoRef.current.room = null;
          setIsDisconnected(false);
          setError(null);
          // Reconnect to start new session
          handleReconnect();
        }}
      />
    );
  }

  // Show evaluating state
  if (isEvaluating || isEvaluationProcessing) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-white text-center p-8 max-w-md">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-2xl mb-2 font-semibold">Evaluating Conversation</p>
          <p className="text-lg text-gray-300">Please wait while we analyze your performance...</p>
        </div>
      </div>
    );
  }

  // Show friendly disconnect message or error (only if evaluation is not showing)
  if (isDisconnected && !error && !showEvaluation && !evaluationCompleted) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-white text-center p-8 max-w-md">
          <p className="text-2xl mb-4 font-semibold">Agent is waiting</p>
          <p className="text-lg mb-6 text-gray-300">
            Please click here to connect with Agent
          </p>
          <button
            onClick={handleReconnect}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors duration-200"
          >
            Connect with Agent
          </button>
        </div>
      </div>
    );
  }

  // Show error message if connection failed (only if evaluation is not showing)
  if (error && !isEvaluating && !isEvaluationProcessing && !showEvaluation) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-white text-xl text-center p-4">
          <p className="mb-2">Connection Error</p>
          <p className="text-sm text-gray-400 mb-4">{error}</p>
          <button
            onClick={handleReconnect}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors duration-200"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <RoomContext.Provider value={room}>
      <div data-lk-theme="default" style={{ height: '100vh', position: 'relative' }}>
        {/* Agent-only video component */}
        <AgentOnlyVideoConference />
        {/* The RoomAudioRenderer takes care of room-wide audio for you. */}
        <RoomAudioRenderer />
        {/* Custom modern control bar */}
        <CustomControlBar 
          room={room} 
          onLeave={async () => {
            // Get current transcript
            let currentTranscript = transcriptRef.current;
            // Use actual room name from LiveKit room object
            const actualRoomName = room.name || roomInfoRef.current.room;
            
            // Log transcript before evaluation
            console.log('=== LEAVING CALL - TRANSCRIPT ===');
            console.log('Transcript entries:', currentTranscript.length);
            console.log('Full transcript:', JSON.stringify(currentTranscript, null, 2));
            console.log('Room name:', actualRoomName);
            console.log('Room object name:', room.name);
            console.log('RoomInfoRef name:', roomInfoRef.current.room);
            
            // Disconnect from room first
            room.disconnect();
            
            // Set evaluation processing state
            setIsEvaluationProcessing(true);
            setIsDisconnected(false);
            
            // Wait a moment for backend to save transcript
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // If local transcript is empty, fetch complete conversation from backend
            if (currentTranscript.length === 0 && actualRoomName) {
              console.log(`Local transcript is empty, fetching complete conversation from backend for room: ${actualRoomName}...`);
              const backendTranscript = await fetchConversationHistory(actualRoomName);
              if (backendTranscript && backendTranscript.length > 0) {
                currentTranscript = backendTranscript;
                console.log(`Fetched ${backendTranscript.length} complete conversation entries from backend`);
              }
            }
            
            // Evaluate using the transcript we have
            try {
              if (currentTranscript.length > 0) {
                console.log(`Evaluating conversation with ${currentTranscript.length} entries...`);
                const evaluation = await evaluateRawConversation(currentTranscript);
                
                if (evaluation) {
                  setEvaluationResult(evaluation);
                  setIsEvaluationProcessing(false);
                  setEvaluationCompleted(true);
                  setShowEvaluation(true); // Show evaluation modal
                } else {
                  setEvaluationResult('Evaluation completed but no results were returned.');
                  setIsEvaluationProcessing(false);
                  setEvaluationCompleted(true);
                  setShowEvaluation(true); // Show evaluation modal
                }
              } else {
                console.log('No transcript available for evaluation');
                setEvaluationResult('No conversation transcript available for evaluation. Please wait for the conversation to complete.');
                setIsEvaluationProcessing(false);
                setEvaluationCompleted(true);
                setShowEvaluation(true); // Show evaluation modal
              }
            } catch (evalError) {
              console.error('Error evaluating conversation:', evalError);
              const errorMsg = evalError.response?.data?.detail || 
                             evalError.message || 
                             'Failed to evaluate conversation';
              setEvaluationResult(`Error: ${errorMsg}`);
              setIsEvaluationProcessing(false);
              setEvaluationCompleted(true);
              setShowEvaluation(true); // Show evaluation modal
            }
          }}
        />
      </div>
    </RoomContext.Provider>
  );
};

// Evaluation Modal Component
const EvaluationModal = ({ evaluation, transcript, onClose, onStartNew }) => {
  const [copied, setCopied] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Animation on mount
  useEffect(() => {
    setIsVisible(true);
  }, []);

  // Helper function to extract evaluation text for copying
  const getEvaluationText = () => {
    if (typeof evaluation === 'string') return evaluation;
    if (evaluation && typeof evaluation === 'object') {
      const evalText = evaluation.evaluation || evaluation.result || evaluation.text || evaluation.message || evaluation.output;
      if (evaluation.scores || evaluation.score) {
        const scores = evaluation.scores || (evaluation.score ? { Overall: evaluation.score } : {});
        let text = 'Evaluation Scores:\n';
        Object.entries(scores).forEach(([key, value]) => {
          text += `${key}: ${typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : value}\n`;
        });
        if (evalText) {
          text += `\nEvaluation Details:\n${typeof evalText === 'string' ? evalText : JSON.stringify(evalText, null, 2)}`;
        }
        return text;
      }
      return evalText ? (typeof evalText === 'string' ? evalText : JSON.stringify(evalText, null, 2)) : JSON.stringify(evaluation, null, 2);
    }
    return 'No evaluation data available.';
  };

  // Copy to clipboard function
  const handleCopy = async () => {
    try {
      const textToCopy = getEvaluationText();
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      try {
        const textArea = document.createElement('textarea');
        textArea.value = getEvaluationText();
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
    }
  };

  // Render markdown content logic
  const renderMarkdownContent = (text) => {
    if (!text) return null;
    const sections = text.split(/\n\n+/);
    
    return (
      <div className="space-y-6 text-gray-300 leading-relaxed font-light">
        {sections.map((section, idx) => {
          const content = section.trim();
          if (!content) return null;

          // Headings
          if (content.match(/^#{1,6}\s+/)) {
            const level = content.match(/^(#{1,6})/)[1].length;
            const headingText = content.replace(/^#{1,6}\s+/, '');
            
            const sizes = {
              1: "text-2xl font-semibold text-white mt-6 mb-4",
              2: "text-xl font-medium text-white/90 mt-5 mb-3",
              3: "text-lg font-medium text-white/80 mt-4 mb-2",
            };
            
            return (
              <div key={idx} className={sizes[level] || sizes[3]}>
                {headingText}
              </div>
            );
          }
          
          // Lists
          if (content.match(/^(\d+\.|-|\*)\s+/)) {
            const listItems = content.split(/\n(?=(\d+\.|-|\*)\s+)/);
            return (
              <ul key={idx} className="space-y-3 my-4 ml-4">
                {listItems.map((item, i) => {
                  const itemText = item.replace(/^(\d+\.|-|\*)\s+/, '').trim();
                  // Basic bold parsing
                  const parts = itemText.split(/(\*\*.*?\*\*)/g);
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2.5 flex-shrink-0" />
                      <span>
                        {parts.map((part, p) => (
                           part.startsWith('**') && part.endsWith('**') 
                            ? <strong key={p} className="text-white font-medium">{part.slice(2, -2)}</strong> 
                            : part
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            );
          }

          // Tables
          if (content.includes('|') && content.split('\n').some(l => l.includes('|'))) {
             const rows = content.split('\n').filter(l => l.includes('|') && !l.match(/^\s*\|[-:]+\|\s*$/));
             const headers = rows[0]?.split('|').slice(1, -1).map(h => h.trim());
             const data = rows.slice(2).map(r => r.split('|').slice(1, -1).map(c => c.trim()));
             
             return (
               <div key={idx} className="overflow-x-auto my-6 rounded-xl border border-white/10 bg-white/5">
                 <table className="w-full text-sm">
                   <thead>
                     <tr className="bg-white/5 border-b border-white/10">
                       {headers?.map((h, hIdx) => (
                         <th key={hIdx} className="px-6 py-4 text-left font-medium text-gray-200">{h.replace(/\*\*/g, '')}</th>
                       ))}
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                     {data.map((row, rIdx) => (
                       <tr key={rIdx} className="hover:bg-white/5 transition-colors">
                         {row.map((cell, cIdx) => (
                           <td key={cIdx} className="px-6 py-4 text-gray-400">
                             {cell.replace(/\*\*(.*?)\*\*/g, '$1')}
                           </td>
                         ))}
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             );
          }

          // Paragraphs
          return (
            <p key={idx} className="mb-4">
              {content.split(/(\*\*.*?\*\*)/g).map((part, p) => (
                 part.startsWith('**') && part.endsWith('**') 
                  ? <strong key={p} className="text-white font-medium">{part.slice(2, -2)}</strong> 
                  : part
              ))}
            </p>
          );
        })}
      </div>
    );
  };

  // Score Component
  const ScoreCard = ({ label, value }) => {
    const percentage = typeof value === 'number' ? value * 100 : parseFloat(value);
    const score = Math.min(100, Math.max(0, percentage));
    
    let color = "text-emerald-400";
    let bg = "bg-emerald-500/20";
    let border = "border-emerald-500/30";
    
    if (score < 60) {
      color = "text-rose-400";
      bg = "bg-rose-500/20";
      border = "border-rose-500/30";
    } else if (score < 80) {
      color = "text-amber-400";
      bg = "bg-amber-500/20";
      border = "border-amber-500/30";
    }

    return (
      <div className={`p-5 rounded-2xl bg-slate-800/50 border ${border} backdrop-blur-sm flex flex-col items-center justify-center gap-2 group hover:scale-[1.02] transition-transform duration-300`}>
        <div className="relative w-20 h-20 flex items-center justify-center">
           <svg className="w-full h-full transform -rotate-90">
             <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-gray-700" />
             <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="6" fill="transparent" 
               className={color}
               strokeDasharray={`${2 * Math.PI * 36}`}
               strokeDashoffset={`${2 * Math.PI * 36 * (1 - score / 100)}`}
               strokeLinecap="round"
             />
           </svg>
           <span className={`absolute text-xl font-bold ${color}`}>{score.toFixed(0)}%</span>
        </div>
        <span className="text-sm font-medium text-gray-300 text-center mt-2">{label}</span>
      </div>
    );
  };

  const renderContent = () => {
    if (!evaluation) return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <p>No evaluation data available.</p>
      </div>
    );

    if (typeof evaluation === 'string') {
      return (
        <div className="bg-slate-800/30 rounded-2xl p-8 border border-white/10">
          {renderMarkdownContent(evaluation)}
        </div>
      );
    }

    const scores = evaluation.scores || (evaluation.score ? { Overall: evaluation.score } : null);
    const evalText = evaluation.evaluation || evaluation.result || evaluation.text || evaluation.message || evaluation.output || evaluation.details;
    const additionalInfo = Object.fromEntries(
      Object.entries(evaluation).filter(([key]) => 
        !['evaluation', 'result', 'text', 'message', 'output', 'scores', 'score', 'details'].includes(key)
      )
    );

    return (
      <div className="space-y-8">
        {/* Scores Grid */}
        {scores && (
           <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
             {Object.entries(scores).map(([k, v]) => (
               <ScoreCard key={k} label={k} value={v} />
             ))}
           </div>
        )}

        {/* Main Feedback */}
        {evalText && (
          <div className="bg-slate-800/30 rounded-3xl p-8 border border-white/10 shadow-inner">
            <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-3">
              <span className="w-1 h-6 bg-blue-500 rounded-full"/>
              Analysis Details
            </h3>
            {typeof evalText === 'string' ? renderMarkdownContent(evalText) : (
              <pre className="whitespace-pre-wrap text-gray-300 font-sans">{JSON.stringify(evalText, null, 2)}</pre>
            )}
          </div>
        )}
        
        {/* JSON Dump for unmatched fields */}
        {Object.keys(additionalInfo).length > 0 && (
          <div className="bg-slate-900/50 rounded-2xl p-6 border border-white/5">
             <h4 className="text-sm font-medium text-gray-500 mb-4 uppercase tracking-wider">Additional Data</h4>
             <pre className="text-xs text-gray-400 font-mono overflow-auto custom-scrollbar p-2">
               {JSON.stringify(additionalInfo, null, 2)}
             </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div 
      className={`fixed inset-0 bg-[#000]/80 backdrop-blur-md flex items-center justify-center z-50 p-4 sm:p-6 transition-all duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className={`bg-[#0F1117] w-full max-w-5xl max-h-[90vh] rounded-[2rem] shadow-2xl overflow-hidden flex flex-col border border-white/10 transition-all duration-500 ${
           isVisible ? 'translate-y-0 scale-100' : 'translate-y-8 scale-95'
        }`}
      >
        {/* Header */}
        <div className="flex-none px-8 py-6 border-b border-white/5 flex items-center justify-between bg-[#151921]">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20 flex-shrink-0" style={{ width: '3.5rem', height: '3.5rem' }}>
              <svg className="w-8 h-8 text-white" width="32" height="32" style={{ width: '2rem', height: '2rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Conversation Evaluation</h2>
              <p className="text-gray-400 text-sm mt-0.5">Your performance analysis</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={handleCopy}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-sm font-medium text-gray-300 transition-all active:scale-95 flex items-center gap-2 group"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4 text-emerald-400" width="16" height="16" style={{ width: '1rem', height: '1rem' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" width="16" height="16" style={{ width: '1rem', height: '1rem' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  <span>Copy Result</span>
                </>
              )}
            </button>
            <button 
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-red-500/10 hover:text-red-400 border border-white/5 flex items-center justify-center text-gray-400 transition-all active:scale-95"
            >
              <svg className="w-5 h-5" width="20" height="20" style={{ width: '1.25rem', height: '1.25rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-[#0B0D12]">
          {renderContent()}
        </div>

        {/* Footer Actions */}
        <div className="flex-none p-6 border-t border-white/5 bg-[#151921] flex justify-end gap-4">
          <button
            onClick={onClose}
            className="px-6 py-3 rounded-xl text-gray-300 font-medium hover:bg-white/5 transition-colors"
          >
            Close
          </button>
          {onStartNew && (
            <button
              onClick={onStartNew}
              className="px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-900/20 active:scale-95 transition-all flex items-center gap-2"
            >
              <svg className="w-5 h-5" width="20" height="20" style={{ width: '1.25rem', height: '1.25rem' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Start New Session
            </button>
          )}
        </div>
      </div>
      
       <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #374151; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4B5563; }
      `}</style>
    </div>
  );
};

// Custom Control Bar Component
const CustomControlBar = ({ room, onLeave }) => {
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Track connection state
  useEffect(() => {
    if (!room) return;

    const updateConnectionState = () => {
      setIsConnected(room.state === ConnectionState.Connected);
    };

    updateConnectionState();

    room.on(RoomEvent.ConnectionStateChanged, updateConnectionState);

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, updateConnectionState);
    };
  }, [room]);

  // Track microphone state
  useEffect(() => {
    if (!room || room.state !== ConnectionState.Connected) return;

    const updateMicState = () => {
      const localParticipant = room.localParticipant;
      if (!localParticipant) {
        setIsMicEnabled(false);
        return;
      }
      
      // Check if microphone track exists and is not muted
      let micEnabled = false;
      for (const publication of localParticipant.audioTrackPublications.values()) {
        if (publication.track && !publication.isMuted) {
          micEnabled = true;
          break;
        }
      }
      setIsMicEnabled(micEnabled);
    };

    // Initial state
    updateMicState();

    // Listen for track changes
    const handleTrackPublished = (publication, participant) => {
      if (participant === room.localParticipant && publication.kind === 'audio') {
        updateMicState();
      }
    };
    
    const handleTrackUnpublished = (publication, participant) => {
      if (participant === room.localParticipant && publication.kind === 'audio') {
        updateMicState();
      }
    };
    
    const handleTrackMuted = (publication, participant) => {
      if (participant === room.localParticipant && publication.kind === 'audio') {
        updateMicState();
      }
    };
    
    const handleTrackUnmuted = (publication, participant) => {
      if (participant === room.localParticipant && publication.kind === 'audio') {
        updateMicState();
      }
    };

    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    room.on(RoomEvent.TrackUnpublished, handleTrackUnpublished);
    room.on(RoomEvent.TrackMuted, handleTrackMuted);
    room.on(RoomEvent.TrackUnmuted, handleTrackUnmuted);

    return () => {
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
      room.off(RoomEvent.TrackUnpublished, handleTrackUnpublished);
      room.off(RoomEvent.TrackMuted, handleTrackMuted);
      room.off(RoomEvent.TrackUnmuted, handleTrackUnmuted);
    };
  }, [room]);

  const toggleMicrophone = async () => {
    if (!room || room.state !== ConnectionState.Connected) return;
    try {
      // Get current microphone state
      let currentMicState = false;
      for (const publication of room.localParticipant.audioTrackPublications.values()) {
        if (publication.track && !publication.isMuted) {
          currentMicState = true;
          break;
        }
      }
      await room.localParticipant.setMicrophoneEnabled(!currentMicState);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
    }
  };

  const handleLeave = () => {
    if (onLeave) {
      onLeave();
    } else if (room) {
      room.disconnect();
    }
  };

  if (!isConnected) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50">
      <style>{`
        .custom-control-bar {
          background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%);
          backdrop-filter: blur(10px);
          padding: 20px 24px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          margin: 0;
        }
        .control-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px 24px;
          border-radius: 12px;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.2s ease;
          cursor: pointer;
          border: none;
          outline: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .control-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
        }
        .control-btn:active {
          transform: translateY(0);
        }
        .mic-btn {
          background: ${isMicEnabled 
            ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
            : 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'};
          color: white;
        }
        .mic-btn:hover {
          background: ${isMicEnabled 
            ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' 
            : 'linear-gradient(135deg, #4b5563 0%, #374151 100%)'};
        }
        .leave-btn {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
        }
        .leave-btn:hover {
          background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        }
        .control-icon {
          width: 18px;
          height: 18px;
          display: inline-block;
        }
      `}</style>
      <div className="custom-control-bar">
        <button
          onClick={toggleMicrophone}
          className="control-btn mic-btn"
          aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
        >
          <svg
            className="control-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            {isMicEnabled ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              />
            )}
          </svg>
          <span>{isMicEnabled ? 'Mute' : 'Unmute'}</span>
        </button>
        <button
          onClick={handleLeave}
          className="control-btn leave-btn"
          aria-label="Leave call"
        >
          <svg
            className="control-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          <span>Leave</span>
        </button>
      </div>
    </div>
  );
};

const AgentOnlyVideoConference = () => {
  // Get all camera tracks
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
    ],
    { onlySubscribed: false },
  );

  // Filter to show only agent tracks (assuming agent has a specific identity or name)
  const agentTracks = tracks.filter(trackRef => {
    // You can customize this logic based on how you identify the agent
    // For example, if the agent has a specific name or identity
    const participantName = trackRef.participant?.name || '';
    const participantIdentity = trackRef.participant?.identity || '';
    
    return participantName === 'tavus-avatar-agent' || 
           participantIdentity === 'tavus-avatar-agent' ||
           participantName.includes('tavus-avatar-agent') ||
           participantIdentity.includes('tavus-avatar-agent');
  });

  // If no agent tracks found, show a loading or placeholder
  if (agentTracks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="text-white text-xl">
          Waiting for agent to join...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <style>{`
        /* Replace participant name with "Insura" */
        .lk-participant-name,
        [class*="participant-name"],
        [class*="ParticipantName"],
        [data-lk-participant-name],
        .lk-participant-tile [class*="name"],
        .lk-participant-tile [class*="Name"] {
          font-size: 0 !important;
          line-height: 0 !important;
          color: transparent !important;
        }
        .lk-participant-name::after,
        [class*="participant-name"]::after,
        [class*="ParticipantName"]::after,
        [data-lk-participant-name]::after,
        .lk-participant-tile [class*="name"]::after,
        .lk-participant-tile [class*="Name"]::after {
          content: "Insura" !important;
          font-size: 0.875rem !important;
          line-height: 1.25rem !important;
          display: block !important;
          color: white !important;
          position: relative !important;
        }
        /* Hide any child elements that might contain the original name */
        .lk-participant-name > *,
        [class*="participant-name"] > *,
        [class*="ParticipantName"] > *,
        [data-lk-participant-name] > * {
          display: none !important;
        }
      `}</style>
      <GridLayout 
        tracks={agentTracks} 
        style={{ height: '100vh' }}
      >
        {/* The GridLayout accepts zero or one child. The child is used
        as a template to render all passed in tracks. */}
        <ParticipantTile />
      </GridLayout>
    </div>
  );
};

export default AgentVideoComponent;
