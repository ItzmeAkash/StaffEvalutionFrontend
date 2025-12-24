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
    console.log('Transcript updated:', transcriptRef.current);
  };

  // Function to process evaluation (reads most recent transcript.txt, generates evaluation, returns both)
  const processEvaluation = async (setLoading = true) => {
    if (setLoading) {
      setIsEvaluating(true);
    }
    try {
      console.log('Processing evaluation from most recent transcript file...');
      console.log('Waiting for transcript to be ready and generating evaluation...');
      
      // Call the new endpoint that processes the most recent transcript file
      const response = await axiosInstance.get(`/process-evaluation`);
      
      console.log('Process evaluation response:', response.data);
      console.log('Full response structure:', JSON.stringify(response.data, null, 2));
      
      // Handle different response structures
      if (response.data) {
        // Check if it's an error message
        if (response.data.detail && response.data.detail.includes('No transcript')) {
          console.log('Transcript not ready yet');
          return null;
        }
        
        // Return the evaluation text
        const evaluation = response.data.evaluation || 
                          response.data.result || 
                          response.data.data ||
                          response.data.text ||
                          response.data.message ||
                          (response.data.detail && !response.data.detail.includes('No transcript') ? response.data.detail : null);
        
        if (evaluation) {
          // Also update transcript if available
          if (response.data.transcript && response.data.transcript.length > 0) {
            setConversationTranscript(response.data.transcript);
            transcriptRef.current = response.data.transcript;
          }
          return evaluation;
        }
        
        return null;
      }
      return null;
    } catch (error) {
      console.error('Error processing evaluation:', error);
      if (error.response) {
        console.error('Error response status:', error.response.status);
        console.error('Error response data:', error.response.data);
        
        // Handle 404 or not found cases (transcript not ready yet)
        if (error.response.status === 404) {
          console.log('Transcript not ready yet. Please wait for conversation to complete.');
          return null;
        }
      }
      throw error;
    } finally {
      if (setLoading) {
        setIsEvaluating(false);
      }
    }
  };

  // Function to evaluate conversation
  const evaluateConversation = async (transcript) => {
    if (!transcript || transcript.length === 0) {
      console.log('No transcript to evaluate');
      return null;
    }

    setIsEvaluating(true);
    try {
      const response = await axiosInstance.post('/evaluate', {
        transcript: transcript,
      });
      
      console.log('Evaluation response:', response.data);
      return response.data.evaluation || response.data.result || response.data;
    } catch (error) {
      console.error('Error evaluating conversation:', error);
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
              }
            }
          });

          // Set up disconnect listener
          room.on(RoomEvent.Disconnected, async (reason) => {
            if (mounted) {
              console.log('Disconnected:', reason);
              
              // Set evaluation processing state
              setIsEvaluationProcessing(true);
              
              // Try to process evaluation from most recent transcript file
              try {
                console.log('Processing evaluation from most recent transcript file...');
                // Wait a bit for backend to save transcript file
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Retry logic: try up to 5 times with increasing delays
                let evaluation = null;
                let retries = 0;
                const maxRetries = 5;
                
                // First call with loading state
                evaluation = await processEvaluation(true);
                
                // Retry without showing loading state each time
                while (retries < maxRetries && !evaluation) {
                  retries++;
                  if (retries < maxRetries) {
                    console.log(`Transcript not ready yet. Retrying in ${retries * 2} seconds... (${retries}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, retries * 2000));
                    evaluation = await processEvaluation(false);
                  }
                }
                
                if (evaluation) {
                  setEvaluationResult(evaluation);
                  setIsEvaluationProcessing(false);
                  setEvaluationCompleted(true);
                  return; // Exit early if we got evaluation
                } else {
                  // Fallback: try with transcript if available
                  console.log('Could not get evaluation from backend, trying with local transcript...');
                  if (transcriptRef.current.length > 0) {
                    try {
                      const evalResult = await evaluateConversation(transcriptRef.current);
                      if (evalResult) {
                        setEvaluationResult(evalResult);
                        setIsEvaluationProcessing(false);
                        setEvaluationCompleted(true);
                      } else {
                        setEvaluationResult('Evaluation completed but no results were returned.');
                        setIsEvaluationProcessing(false);
                        setEvaluationCompleted(true);
                      }
                    } catch (evalError) {
                      console.error('Error evaluating with transcript:', evalError);
                      const errorMsg = evalError.response?.data?.detail || 
                                     evalError.message || 
                                     'Failed to evaluate conversation';
                      setEvaluationResult(`Error: ${errorMsg}`);
                      setIsEvaluationProcessing(false);
                      setEvaluationCompleted(true);
                    }
                  } else {
                    setEvaluationResult('No conversation transcript available. Please wait for the conversation to complete.');
                    setIsEvaluationProcessing(false);
                    setEvaluationCompleted(true);
                  }
                }
              } catch (fetchError) {
                console.error('Error processing evaluation:', fetchError);
                // Try with transcript as fallback
                if (transcriptRef.current.length > 0) {
                  try {
                    const evalResult = await evaluateConversation(transcriptRef.current);
                    if (evalResult) {
                      setEvaluationResult(evalResult);
                      setIsEvaluationProcessing(false);
                      setEvaluationCompleted(true);
                    } else {
                      setEvaluationResult('Evaluation completed but no results were returned.');
                      setIsEvaluationProcessing(false);
                      setEvaluationCompleted(true);
                    }
                  } catch (evalError) {
                    console.error('Error evaluating with transcript:', evalError);
                    const errorMsg = evalError.response?.data?.detail || 
                                   evalError.message || 
                                   'Failed to evaluate conversation';
                    setEvaluationResult(`Error: ${errorMsg}`);
                    setIsEvaluationProcessing(false);
                    setEvaluationCompleted(true);
                  }
                } else {
                  const errorMsg = fetchError.response?.data?.detail || 
                                 fetchError.message || 
                                 'Failed to process evaluation';
                  setEvaluationResult(`Error: ${errorMsg}\n\nNo conversation transcript available.`);
                  setIsEvaluationProcessing(false);
                  setEvaluationCompleted(true);
                }
              }
              
              const reasonStr = typeof reason === 'string' ? reason : (reason?.toString() || 'Unknown');
              if (reasonStr === 'CLIENT_INITIATED' || reasonStr === 'CLIENT_INITIATED_DISCONNECT') {
                setIsDisconnected(true);
              } else {
                setIsDisconnected(true);
              }
            }
          });

          // Listen for data messages (transcript messages from backend)
          room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
            if (mounted && kind === DataPacket_Kind.RELIABLE) {
              try {
                const data = JSON.parse(new TextDecoder().decode(payload));
                if (data.type === 'transcript' && data.role && data.message) {
                  addToTranscript(data.role, data.message);
                } else if (data.role && data.message) {
                  // Also handle direct transcript format
                  addToTranscript(data.role, data.message);
                }
              } catch (e) {
                console.log('Could not parse data message:', e);
              }
            }
          });

          const { token, room: roomName } = await getToken();
          roomInfoRef.current.room = roomName;
          await room.connect(serverUrl, token);
          
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

  // Show evaluation modal
  if (showEvaluation && evaluationResult) {
    return (
      <EvaluationModal
        evaluation={evaluationResult}
        transcript={conversationTranscript}
        onClose={() => {
          setShowEvaluation(false);
          // Don't set disconnected, keep evaluation completed state
        }}
      />
    );
  }

  // Show evaluating state
  if (isEvaluating) {
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

  // Show evaluation processing state
  if (isEvaluationProcessing && !showEvaluation) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <div className="text-white text-center p-8 max-w-md">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-blue-500/30 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-transparent border-t-blue-500 rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <p className="text-3xl mb-3 font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Processing Evaluation
          </p>
          <p className="text-lg mb-2 text-gray-300">
            Analyzing your conversation...
          </p>
          <p className="text-sm text-gray-400">
            This may take a few moments
          </p>
        </div>
      </div>
    );
  }

  // Show evaluation completed, ready to start
  if (evaluationCompleted && !showEvaluation && !isEvaluationProcessing) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <div className="text-white text-center p-8 max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-2xl">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-3xl mb-3 font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            Evaluation Complete
          </p>
          <p className="text-lg mb-6 text-gray-300">
            Your performance has been analyzed
          </p>
          <button
            onClick={() => {
              setShowEvaluation(true);
            }}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold py-3 px-8 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 mb-4"
          >
            View Evaluation Report
          </button>
          <button
            onClick={handleReconnect}
            className="block w-full text-gray-400 hover:text-white transition-colors duration-200 text-sm"
          >
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  // Show friendly disconnect message or error
  if (isDisconnected && !error && !isEvaluationProcessing && !evaluationCompleted) {
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

  // Show error message if connection failed
  if (error && !isEvaluating) {
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
            const currentTranscript = transcriptRef.current;
            
            // Disconnect from room first
            room.disconnect();
            
            // Set evaluation processing state
            setIsEvaluationProcessing(true);
            setIsDisconnected(false);
            
            // Try to process evaluation from most recent transcript file
            try {
              console.log('Processing evaluation from most recent transcript file...');
              // Wait a bit for backend to save transcript file
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              // Retry logic: try up to 5 times with increasing delays
              let evaluation = null;
              let retries = 0;
              const maxRetries = 5;
              
              // First call with loading state
              evaluation = await processEvaluation(true);
              
              // Retry without showing loading state each time
              while (retries < maxRetries && !evaluation) {
                retries++;
                if (retries < maxRetries) {
                  console.log(`Transcript not ready yet. Retrying in ${retries * 2} seconds... (${retries}/${maxRetries})`);
                  await new Promise(resolve => setTimeout(resolve, retries * 2000));
                  evaluation = await processEvaluation(false);
                }
              }
              
              if (evaluation) {
                setEvaluationResult(evaluation);
                setIsEvaluationProcessing(false);
                setEvaluationCompleted(true);
                return;
              } else {
                // Evaluation not found, try with transcript
                console.log('Could not get evaluation from backend, trying with local transcript...');
              }
            } catch (fetchError) {
              console.error('Error processing evaluation:', fetchError);
              // Continue to try with transcript
            }
            
            // Fallback: Evaluate conversation with transcript
            if (currentTranscript.length > 0) {
              try {
                const evaluation = await evaluateConversation(currentTranscript);
                if (evaluation) {
                  setEvaluationResult(evaluation);
                  setIsEvaluationProcessing(false);
                  setEvaluationCompleted(true);
                } else {
                  setEvaluationResult('Evaluation completed but no results were returned.');
                  setIsEvaluationProcessing(false);
                  setEvaluationCompleted(true);
                }
              } catch (evalError) {
                console.error('Error evaluating conversation:', evalError);
                // Show error message
                const errorMsg = evalError.response?.data?.detail || 
                               evalError.message || 
                               'Failed to evaluate conversation';
                setEvaluationResult(`Error: ${errorMsg}`);
                setIsEvaluationProcessing(false);
                setEvaluationCompleted(true);
              }
            } else {
              // No transcript and no evaluation found
              setEvaluationResult('No conversation transcript available for evaluation. Please wait for the conversation to complete.');
              setIsEvaluationProcessing(false);
              setEvaluationCompleted(true);
            }
          }}
        />
      </div>
    </RoomContext.Provider>
  );
};

// Evaluation Modal Component
const EvaluationModal = ({ evaluation, transcript, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Animation on mount
  useEffect(() => {
    setIsVisible(true);
  }, []);


  // Render markdown table as HTML
  const renderMarkdownTable = (tableText) => {
    const rows = tableText.split('\n').filter(line => 
      line.trim().includes('|') && !line.trim().match(/^\|[\s-:]+\|$/)
    );
    
    if (rows.length === 0) return null;

    const parsedRows = rows.map(row => {
      return row.split('|')
        .map(cell => cell.trim())
        .filter(cell => cell.length > 0);
    });

    return (
      <div className="overflow-x-auto my-4">
        <table className="w-full border-collapse bg-slate-800/50 rounded-lg overflow-hidden">
          <thead>
            {parsedRows[0] && (
              <tr className="bg-gradient-to-r from-blue-600/20 to-purple-600/20">
                {parsedRows[0].map((header, idx) => (
                  <th 
                    key={`header-${idx}`}
                    className="px-4 py-3 text-left text-sm font-semibold text-blue-300 border-b border-slate-700/50"
                  >
                    {header.replaceAll('**', '')}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {parsedRows.slice(1).map((row, rowIdx) => (
              <tr 
                key={rowIdx}
                className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors"
              >
                {row.map((cell, cellIdx) => {
                  // Check if cell contains bold text
                  const isBold = cell.includes('**');
                  const cellText = cell.replaceAll('**', '');
                  const isNumber = cellIdx === 2 && /^\d+$/.test(cellText.trim());
                  
                  return (
                    <td 
                      key={`cell-${rowIdx}-${cellIdx}`}
                      className={`px-4 py-3 text-sm text-gray-200 ${
                        isBold ? 'font-bold text-blue-300' : ''
                      } ${isNumber ? 'text-center' : ''}`}
                    >
                      {cellText}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Render markdown content
  const renderMarkdownContent = (text) => {
    if (!text) return null;

    // Split by double newlines to get sections
    const sections = text.split(/\n\n+/);
    const elements = [];

    sections.forEach((section, sectionIdx) => {
      const trimmedSection = section.trim();
      if (!trimmedSection) return;

      // Check if it's a heading
      if (trimmedSection.match(/^#{1,6}\s+/)) {
        const match = trimmedSection.match(/^(#{1,6})/);
        if (match) {
          const level = match[1].length;
          const text = trimmedSection.replace(/^#{1,6}\s+/, '');
          elements.push(
            <div key={`heading-${sectionIdx}`} className="mt-6 mb-4">
              {level === 1 && (
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  {text}
                </h1>
              )}
              {level === 2 && (
                <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent flex items-center gap-3">
                  <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-pink-500 rounded-full"></div>
                  {text}
                </h2>
              )}
              {level >= 3 && (
                <h3 className="text-xl font-semibold text-gray-300 mt-4 mb-2">
                  {text}
                </h3>
              )}
            </div>
          );
        }
      }
      // Check if it's a table
      else if (trimmedSection.includes('|') && trimmedSection.split('\n').some(line => line.includes('|'))) {
        elements.push(
          <div key={`table-${sectionIdx}`}>
            {renderMarkdownTable(trimmedSection)}
          </div>
        );
      }
      // Check if it's a numbered list
      else if (trimmedSection.match(/^\d+\.\s+/)) {
        const items = trimmedSection.split(/\n(?=\d+\.\s+)/);
        elements.push(
          <ul key={`list-${sectionIdx}`} className="list-decimal list-inside space-y-2 my-4 ml-4">
            {items.map((item, itemIdx) => {
              const text = item.replace(/^\d+\.\s+/, '').trim();
              // Check for bold text
              const parts = text.split(/(\*\*.*?\*\*)/g);
              return (
                <li key={`list-item-${sectionIdx}-${itemIdx}`} className="text-gray-200 leading-relaxed">
                  {parts.map((part, partIdx) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                      return <strong key={`part-${itemIdx}-${partIdx}`} className="text-blue-300 font-semibold">{part.slice(2, -2)}</strong>;
                    }
                    return <span key={`part-${itemIdx}-${partIdx}`}>{part}</span>;
                  })}
                </li>
              );
            })}
          </ul>
        );
      }
      // Regular paragraph
      else {
        const lines = trimmedSection.split('\n');
        lines.forEach((line, lineIdx) => {
          if (line.trim()) {
            // Check for bold text
            const parts = line.split(/(\*\*.*?\*\*)/g);
            elements.push(
              <p key={`para-${sectionIdx}-${lineIdx}`} className="text-gray-200 leading-relaxed mb-3">
                {parts.map((part, partIdx) => {
                  if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={`para-part-${lineIdx}-${partIdx}`} className="text-blue-300 font-semibold">{part.slice(2, -2)}</strong>;
                  }
                  return <span key={`para-part-${lineIdx}-${partIdx}`}>{part}</span>;
                })}
              </p>
            );
          }
        });
      }
    });

    return <div className="space-y-2">{elements}</div>;
  };

  // Helper function to extract evaluation text for copying
  const getEvaluationText = () => {
    if (typeof evaluation === 'string') {
      return evaluation;
    }

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
      
      if (evalText) {
        return typeof evalText === 'string' ? evalText : JSON.stringify(evalText, null, 2);
      }
      
      return JSON.stringify(evaluation, null, 2);
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
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = getEvaluationText();
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      textArea.remove();
    }
  };

  // Helper function to get score icon with proper colors and sizes
  const getScoreIcon = (percentage, size = 'md', customColor = null) => {
    const sizeClasses = {
      sm: 'w-4 h-4',
      md: 'w-6 h-6',
      lg: 'w-8 h-8',
      xl: 'w-10 h-10'
    };
    
    const sizeClass = sizeClasses[size] || sizeClasses.md;
    
    // Determine icon color based on percentage if custom color not provided
    let iconColor = customColor;
    if (!iconColor) {
      if (percentage >= 80) {
        iconColor = 'text-emerald-400';
      } else if (percentage >= 70) {
        iconColor = 'text-blue-400';
      } else if (percentage >= 50) {
        iconColor = 'text-yellow-400';
      } else {
        iconColor = 'text-red-400';
      }
    }
    
    if (percentage >= 80) {
      return (
        <svg 
          className={`${sizeClass} ${iconColor} flex-shrink-0`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2.5} 
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" 
          />
        </svg>
      );
    } else if (percentage >= 70) {
      return (
        <svg 
          className={`${sizeClass} ${iconColor} flex-shrink-0`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2.5} 
            d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" 
          />
        </svg>
      );
    } else if (percentage >= 50) {
      return (
        <svg 
          className={`${sizeClass} ${iconColor} flex-shrink-0`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2.5} 
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
          />
        </svg>
      );
    } else {
      return (
        <svg 
          className={`${sizeClass} ${iconColor} flex-shrink-0`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2.5} 
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
          />
        </svg>
      );
    }
  };

  // Helper function to render evaluation content
  const renderEvaluationContent = () => {
    if (typeof evaluation === 'string') {
      // Check if it contains markdown tables
      const hasTables = evaluation.includes('|') && evaluation.split('\n').some(line => line.includes('|'));
      
      return (
        <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 rounded-2xl p-8 border border-slate-700/50 shadow-2xl backdrop-blur-sm relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 pointer-events-none"></div>
          <div className="relative z-10">
            {hasTables ? (
              <div className="space-y-6">
                {renderMarkdownContent(evaluation)}
              </div>
            ) : (
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-blue-500/30 flex-shrink-0 shadow-lg">
                  <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-4">Evaluation Summary</h3>
                  <div className="whitespace-pre-wrap text-gray-200 leading-relaxed text-base font-normal">
                    {evaluation}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (evaluation && typeof evaluation === 'object') {
      // Check for common evaluation result structures
      const evalText = evaluation.evaluation || evaluation.result || evaluation.text || evaluation.message || evaluation.output;
      
      // If there are scores, display them nicely
      if (evaluation.scores || evaluation.score) {
        const scores = evaluation.scores || (evaluation.score ? { Overall: evaluation.score } : {});
        const scoreEntries = Object.entries(scores);
        const overallScore = scoreEntries.length > 0 ? (typeof scoreEntries[0][1] === 'number' ? scoreEntries[0][1] : parseFloat(scoreEntries[0][1])) : null;
        
        return (
          <div className="space-y-8 animate-fade-in">
            {/* Overall Score Banner */}
            {overallScore !== null && (
              <div className="bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-pink-600/20 rounded-2xl p-6 border border-blue-500/30 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 animate-pulse"></div>
                <div className="relative z-10 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-1">Overall Performance</p>
                    <p className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                      {(overallScore * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 ${
                    overallScore >= 0.8 ? 'bg-emerald-500/20 border-4 border-emerald-400 ring-4 ring-emerald-400/20' :
                    overallScore >= 0.6 ? 'bg-yellow-500/20 border-4 border-yellow-400 ring-4 ring-yellow-400/20' :
                    'bg-red-500/20 border-4 border-red-400 ring-4 ring-red-400/20'
                  }`}>
                    <div className="relative">
                      {getScoreIcon(
                        overallScore * 100, 
                        'xl',
                        overallScore >= 0.8 ? 'text-emerald-400' :
                        overallScore >= 0.6 ? 'text-yellow-400' :
                        'text-red-400'
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Scores Section */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-1 h-8 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full"></div>
                <h3 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Detailed Scores
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {scoreEntries.map(([key, value], index) => {
                  const numValue = typeof value === 'number' ? value : parseFloat(value);
                  const percentage = numValue * 100;
                  const isExcellent = percentage >= 80;
                  const isGood = percentage >= 70;
                  const isAverage = percentage >= 50 && percentage < 70;
                  
                  const colorClasses = isExcellent 
                    ? 'from-emerald-500/20 to-green-500/20 border-emerald-400/40 text-emerald-400'
                    : isGood 
                    ? 'from-blue-500/20 to-cyan-500/20 border-blue-400/40 text-blue-400'
                    : isAverage
                    ? 'from-yellow-500/20 to-orange-500/20 border-yellow-400/40 text-yellow-400'
                    : 'from-red-500/20 to-pink-500/20 border-red-400/40 text-red-400';
                  
                  const progressColor = isExcellent
                    ? 'from-emerald-500 to-green-400'
                    : isGood
                    ? 'from-blue-500 to-cyan-400'
                    : isAverage
                    ? 'from-yellow-500 to-orange-400'
                    : 'from-red-500 to-pink-400';
                  
                  return (
                    <div 
                      key={key}
                      className={`bg-gradient-to-br ${colorClasses} rounded-2xl p-6 border-2 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 hover:-translate-y-1 relative overflow-hidden group`}
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                      <div className="relative z-10">
                        <div className="flex items-center justify-between mb-4 gap-3">
                          <div className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex-1 min-w-0">
                            {key}
                          </div>
                          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center border border-slate-600/50">
                            {getScoreIcon(
                              percentage,
                              'md',
                              isExcellent ? 'text-emerald-400' :
                              isGood ? 'text-blue-400' :
                              isAverage ? 'text-yellow-400' :
                              'text-red-400'
                            )}
                          </div>
                        </div>
                        <div className={`text-4xl font-bold mb-4 ${colorClasses.split(' ')[2]}`}>
                          {typeof value === 'number' ? `${percentage.toFixed(1)}%` : value}
                        </div>
                        {typeof value === 'number' && (
                          <div className="relative w-full bg-gray-800/50 rounded-full h-3 overflow-hidden backdrop-blur-sm">
                            <div 
                              className={`h-full rounded-full bg-gradient-to-r ${progressColor} transition-all duration-1000 ease-out shadow-lg`}
                              style={{ width: `${Math.min(percentage, 100)}%` }}
                            >
                              <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Evaluation Text */}
            {evalText && (
              <div className="animate-fade-in" style={{ animationDelay: '300ms' }}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-pink-500 rounded-full"></div>
                  <h3 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-rose-400 bg-clip-text text-transparent">
                    Evaluation Details
                  </h3>
                </div>
                <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 rounded-2xl p-8 border border-slate-700/50 shadow-2xl backdrop-blur-sm relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 pointer-events-none"></div>
                  <div className="relative z-10">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center border border-purple-500/30 flex-shrink-0 shadow-lg">
                        <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        {typeof evalText === 'string' && evalText.includes('|') ? (
                          renderMarkdownContent(evalText)
                        ) : (
                          <div className="whitespace-pre-wrap text-gray-200 leading-relaxed text-base font-normal">
                            {typeof evalText === 'string' ? evalText : JSON.stringify(evalText, null, 2)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Other fields */}
            {Object.keys(evaluation).filter(key => 
              !['evaluation', 'result', 'text', 'message', 'output', 'scores', 'score'].includes(key)
            ).length > 0 && (
              <div className="animate-fade-in" style={{ animationDelay: '400ms' }}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-1 h-8 bg-gradient-to-b from-cyan-500 to-blue-500 rounded-full"></div>
                  <h3 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                    Additional Information
                  </h3>
                </div>
                <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 rounded-2xl p-8 border border-slate-700/50 shadow-2xl backdrop-blur-sm relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 pointer-events-none"></div>
                  <div className="relative z-10">
                    <pre className="text-gray-200 text-sm overflow-x-auto font-mono leading-relaxed">
                      {JSON.stringify(
                        Object.fromEntries(
                          Object.entries(evaluation).filter(([key]) => 
                            !['evaluation', 'result', 'text', 'message', 'output', 'scores', 'score'].includes(key)
                          )
                        ),
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }
      
      // If it's just text content
      if (evalText) {
        return (
          <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 rounded-2xl p-8 border border-slate-700/50 shadow-2xl backdrop-blur-sm relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 pointer-events-none"></div>
            <div className="relative z-10">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-blue-500/30 flex-shrink-0 shadow-lg">
                  <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  {typeof evalText === 'string' && evalText.includes('|') ? (
                    renderMarkdownContent(evalText)
                  ) : (
                    <div className="whitespace-pre-wrap text-gray-200 leading-relaxed text-base font-normal">
                      {typeof evalText === 'string' ? evalText : JSON.stringify(evalText, null, 2)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      }
      
      // Fallback: show as JSON
      return (
        <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 rounded-2xl p-8 border border-slate-700/50 shadow-2xl backdrop-blur-sm">
          <pre className="text-gray-200 text-sm overflow-x-auto font-mono leading-relaxed">
            {JSON.stringify(evaluation, null, 2)}
          </pre>
        </div>
      );
    }

    return (
      <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 rounded-2xl p-8 border border-slate-700/50 shadow-2xl backdrop-blur-sm">
        <div className="text-gray-300 text-center py-12">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-lg font-medium">No evaluation data available.</p>
        </div>
      </div>
    );
  };

  return (
    <div 
      className={`fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className={`bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white rounded-3xl max-w-6xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl border border-slate-700/50 backdrop-blur-xl transition-all duration-300 ${
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-700/50 bg-gradient-to-r from-slate-800/80 via-slate-800/60 to-slate-800/80 backdrop-blur-sm relative">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-pink-500/5 pointer-events-none"></div>
          <div className="relative z-10 flex items-center gap-4 flex-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                Conversation Evaluation
              </h2>
              <p className="text-sm text-gray-400 mt-1">Your performance analysis</p>
            </div>
          </div>
          <div className="relative z-10 flex items-center gap-3">
            {/* Copy Button */}
            <button
              onClick={handleCopy}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-200 border font-medium ${
                copied 
                  ? 'bg-green-500/20 border-green-400/50 text-green-400' 
                  : 'bg-slate-800/80 hover:bg-slate-700/80 text-gray-300 hover:text-white border-slate-600/50 hover:border-slate-500/50'
              } shadow-lg hover:shadow-xl hover:scale-105`}
              title="Copy evaluation results"
            >
              {copied ? (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm font-semibold">Copied!</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm font-semibold">Copy</span>
                </>
              )}
            </button>
            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2.5 text-gray-400 hover:text-white hover:bg-slate-700/80 rounded-xl transition-all duration-200 border border-transparent hover:border-slate-600/50"
              title="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-none">
            {renderEvaluationContent()}
          </div>
        </div>
        
        {/* Footer */}
        <div className="p-6 border-t border-slate-700/50 bg-gradient-to-r from-slate-800/80 via-slate-800/60 to-slate-800/80 backdrop-blur-sm">
          <button
            onClick={onClose}
            className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-700 hover:via-purple-700 hover:to-pink-700 text-white font-bold py-4 px-8 rounded-xl transition-all duration-200 shadow-xl hover:shadow-2xl transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Close Evaluation
          </button>
        </div>
      </div>
      
      {/* Custom Styles */}
      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        
        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
          opacity: 0;
        }
        
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
        
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.5);
          border-radius: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, rgba(59, 130, 246, 0.5), rgba(147, 51, 234, 0.5));
          border-radius: 5px;
          border: 2px solid rgba(15, 23, 42, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(to bottom, rgba(59, 130, 246, 0.8), rgba(147, 51, 234, 0.8));
        }
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
