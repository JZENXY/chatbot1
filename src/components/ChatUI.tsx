'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Send, Bot, User, Paperclip, FileText, X } from 'lucide-react';

type Message = {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
  hasAttachment?: boolean;
  attachmentName?: string;
};

type GeminiContent = {
  role: 'user' | 'model';
  parts: { text: string }[];
};

type UploadedFile = {
  name: string;
  content: string;
  type: 'pdf';
};

// Extend Window interface for PDF.js
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export default function ChatUI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<GeminiContent[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [pdfJsLoaded, setPdfJsLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  // Gemini API configuration
  const GEMINI_API_KEY = '...';
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  // Load PDF.js from CDN
  useEffect(() => {
    const loadPdfJs = () => {
      if (window.pdfjsLib) {
        setPdfJsLoaded(true);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.onload = () => {
        // Set worker source after script loads
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        setPdfJsLoaded(true);
      };
      script.onerror = () => {
        console.error('Failed to load PDF.js');
      };
      document.head.appendChild(script);
    };

    loadPdfJs();
  }, []);

  // Fix hydration issues
  useEffect(() => {
    setMounted(true);
    // Initialize with welcome message
    setMessages([
      { 
        id: 'welcome', 
        sender: 'assistant', 
        text: 'Hi, how can I help you today? You can also upload PDF files for me to analyze!',
        timestamp: Date.now()
      },
    ]);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const extractTextFromPDF = async (file: File): Promise<string> => {
    if (!pdfJsLoaded || !window.pdfjsLib) {
      throw new Error('PDF.js not loaded');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';

          console.log(`PDF loaded successfully. Total pages: ${pdf.numPages}`);
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .map((item: any) => item.str)
              .join(' ');
            
            fullText += `Page ${i}:\n${pageText}\n\n`;
            console.log(`Page ${i} extracted:`, pageText);
          }

          console.log('Complete PDF content:', fullText);
          resolve(fullText);
        } catch (error) {
          console.error('Error extracting PDF text:', error);
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert('Please upload only PDF files');
      return;
    }

    if (!pdfJsLoaded) {
      alert('PDF processing library is still loading. Please try again in a moment.');
      return;
    }

    setIsProcessingFile(true);
    
    try {
      const extractedText = await extractTextFromPDF(file);
      
      const newFile: UploadedFile = {
        name: file.name,
        content: extractedText,
        type: 'pdf'
      };

      setUploadedFiles(prev => [...prev, newFile]);

      // Add file upload message
      const fileMessage: Message = {
        id: `file-${Date.now()}`,
        sender: 'user',
        text: `Uploaded: ${file.name}`,
        timestamp: Date.now(),
        hasAttachment: true,
        attachmentName: file.name
      };

      setMessages(prev => [...prev, fileMessage]);

      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (error) {
      console.error('Error processing PDF:', error);
      alert('Failed to process PDF file. Please try again.');
    } finally {
      setIsProcessingFile(false);
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const callGeminiAPI = async (userMessage: string, includeFileContent: boolean = true): Promise<string> => {
    try {
      // Prepare the message - conditionally include file content
      let messageForAPI = userMessage;
      if (includeFileContent && uploadedFiles.length > 0) {
        const fileContext = uploadedFiles
          .map(file => `Content from ${file.name}:\n${file.content}`)
          .join('\n\n');
        messageForAPI = `Context from uploaded files:\n${fileContext}\n\nUser question: ${userMessage}`;
      }

      // Add the new user message to conversation history
      const newUserContent: GeminiContent = {
        role: 'user',
        parts: [{ text: messageForAPI }]
      };

      const updatedHistory = [...conversationHistory, newUserContent];

      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: updatedHistory
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Extract the response text
      const aiResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
      
      // Update conversation history with AI response
      const aiContent: GeminiContent = {
        role: 'model',
        parts: [{ text: aiResponseText }]
      };
      
      setConversationHistory([...updatedHistory, aiContent]);
      
      return aiResponseText;
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      return 'Sorry, I encountered an error while processing your request. Please try again.';
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    // Create user message for UI (only show the text, not file content)
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      // Call Gemini API with file content included if files are uploaded
      const aiResponse = await callGeminiAPI(text, uploadedFiles.length > 0);
      
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        text: aiResponse,
        timestamp: Date.now(),
      };
      
      setMessages((prev) => [...prev, assistantMessage]);
      
      // Clear uploaded files after successful message send
      setUploadedFiles([]);
      
    } catch (error) {
      console.error('Error in handleSend:', error);
      const errorMessage: Message = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        text: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Show loading state until mounted
  if (!mounted) {
    return (
      <div style={{
        width: '100%',
        maxWidth: '28rem',
        margin: '0 auto',
        backgroundColor: '#18181b',
        borderRadius: '0.5rem',
        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
        display: 'flex',
        flexDirection: 'column',
        height: '600px',
        border: '1px solid #3f3f46'
      }}>
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: '#71717a'
        }}>
          Loading chat...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      maxWidth: '28rem',
      margin: '0 auto',
      backgroundColor: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: '0.5rem',
      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
      display: 'flex',
      flexDirection: 'column',
      height: '600px'
    }}>
      {/* Header */}
      <div style={{
        padding: '0.75rem 1rem',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Avatar style={{ height: '2rem', width: '2rem' }}>
            <AvatarImage src="/bot-avatar.png" />
            <AvatarFallback style={{ 
              backgroundColor: '#3b82f6', 
              color: 'white', 
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Bot style={{ height: '1rem', width: '1rem' }} />
            </AvatarFallback>
          </Avatar>
          <div style={{ textAlign: 'center' }}>
            <div style={{ 
              fontSize: '0.875rem', 
              fontWeight: '600', 
              color: '#111827' 
            }}>
              Chatbot
            </div>
            <div style={{ 
              fontSize: '0.75rem', 
              color: '#22c55e' 
            }}>
              Online
            </div>
          </div>
        </div>
      </div>

      {/* Uploaded Files Display */}
      {uploadedFiles.length > 0 && (
        <div style={{
          padding: '0.5rem 1rem',
          backgroundColor: '#f0f9ff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'center'
        }}>
          <span style={{ 
            fontSize: '0.75rem', 
            color: '#1e40af',
            fontWeight: '600'
          }}>
            {uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''} will be included in next message:
          </span>
          {uploadedFiles.map((file, index) => (
            <div key={index} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              backgroundColor: '#dbeafe',
              padding: '0.25rem 0.5rem',
              borderRadius: '0.375rem',
              fontSize: '0.75rem',
              color: '#1e40af'
            }}>
              <FileText style={{ height: '0.75rem', width: '0.75rem' }} />
              <span>{file.name}</span>
              <button
                onClick={() => removeFile(index)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <X style={{ height: '0.75rem', width: '0.75rem', color: '#dc2626' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          padding: '1rem',
          overflowY: 'auto',
          backgroundColor: '#f9fafb',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start'
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              maxWidth: '80%',
              flexDirection: msg.sender === 'user' ? 'row-reverse' : 'row'
            }}>
              <Avatar style={{ height: '1.5rem', width: '1.5rem', flexShrink: 0 }}>
                <AvatarImage src={msg.sender === 'user' ? '/user-avatar.png' : '/bot-avatar.png'} />
                <AvatarFallback style={{
                  fontSize: '0.75rem',
                  backgroundColor: msg.sender === 'user' ? '#3b82f6' : '#6b7280',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {msg.sender === 'user' ? 
                    <User style={{ height: '0.75rem', width: '0.75rem' }} /> : 
                    <Bot style={{ height: '0.75rem', width: '0.75rem' }} />
                  }
                </AvatarFallback>
              </Avatar>
              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.5rem',
                  fontSize: '0.875rem',
                  wordBreak: 'break-word',
                  backgroundColor: msg.sender === 'user' ? '#3b82f6' : '#ffffff',
                  color: msg.sender === 'user' ? 'white' : '#111827',
                  border: msg.sender === 'user' ? 'none' : '1px solid #e5e7eb',
                  borderBottomLeftRadius: msg.sender === 'user' ? '0.5rem' : '0.125rem',
                  borderBottomRightRadius: msg.sender === 'user' ? '0.125rem' : '0.5rem',
                  whiteSpace: 'pre-wrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                {msg.hasAttachment && (
                  <FileText style={{ 
                    height: '1rem', 
                    width: '1rem',
                    color: msg.sender === 'user' ? 'white' : '#6b7280'
                  }} />
                )}
                {msg.text}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              maxWidth: '80%'
            }}>
              <Avatar style={{ height: '1.5rem', width: '1.5rem' }}>
                <AvatarImage src="/bot-avatar.png" />
                <AvatarFallback style={{
                  backgroundColor: '#6b7280',
                  color: 'white',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Bot style={{ height: '0.75rem', width: '0.75rem' }} />
                </AvatarFallback>
              </Avatar>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '0.5rem',
                borderBottomLeftRadius: '0.125rem'
              }}>
                <Loader2 style={{ 
                  height: '0.75rem', 
                  width: '0.75rem', 
                  color: '#6b7280',
                  animation: 'spin 1s linear infinite'
                }} />
                <span style={{ 
                  fontSize: '0.75rem', 
                  color: '#6b7280' 
                }}>
                  Typing...
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: '1rem',
        borderTop: '1px solid #e5e7eb',
        backgroundColor: '#ffffff'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf"
            style={{ display: 'none' }}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingFile || !pdfJsLoaded}
            size="sm"
            style={{
              height: '2.25rem',
              width: '2.25rem',
              padding: 0,
              borderRadius: '0.5rem',
              backgroundColor: pdfJsLoaded && !isProcessingFile ? '#6b7280' : '#9ca3af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: pdfJsLoaded && !isProcessingFile ? 'pointer' : 'not-allowed'
            }}
            title="Upload PDF file"
          >
            {isProcessingFile ? (
              <Loader2 style={{ 
                height: '1rem', 
                width: '1rem', 
                color: 'white',
                animation: 'spin 1s linear infinite'
              }} />
            ) : (
              <Paperclip style={{ height: '1rem', width: '1rem', color: 'white' }} />
            )}
          </Button>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              placeholder="Type your message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isTyping}
              style={{
                width: '100%',
                backgroundColor: '#f3f4f6',
                color: '#111827',
                borderRadius: '0.5rem',
                padding: '0.5rem 1rem',
                border: '1px solid #d1d5db',
                outline: 'none',
                fontSize: '0.875rem'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#3b82f6';
                e.target.style.boxShadow = '0 0 0 2px rgb(59 130 246 / 0.5)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            size="sm"
            style={{
              height: '2.25rem',
              width: '2.25rem',
              padding: 0,
              borderRadius: '0.5rem',
              backgroundColor: input.trim() && !isTyping ? '#3b82f6' : '#9ca3af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: input.trim() && !isTyping ? 'pointer' : 'not-allowed'
            }}
          >
            <Send style={{ height: '1rem', width: '1rem', color: 'white' }} />
          </Button>
        </div>
      </div>
    </div>
  );
}
