
export interface Attachment {
  data: string; // base64
  mimeType: string;
  name: string;
}

export interface Message {
  role: 'user' | 'model';
  parts: { text: string }[];
  timestamp: number;
  attachments?: Attachment[];
  isImage?: boolean; // To flag if the model response is an generated image
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  timestamp: number;
}

export enum AppMode {
  CHAT = 'CHAT',
  LIVE = 'LIVE'
}
