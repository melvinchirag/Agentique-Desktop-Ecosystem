export interface StyleProfile {
  version: 1;
  learnedAt: string;
  sampled: number;
  source: 'llm' | 'stats';
  greetings: string[];
  signoffs: string[];
  formality: 1 | 2 | 3 | 4 | 5;
  avgWords: number;
  avgSentences: number;
  paragraphs: 'one' | 'short' | 'multi';
  emojiUse: 'never' | 'rare' | 'often';
  exclamations: 'rare' | 'some' | 'often';
  contractions: boolean;
  startsLowercase: boolean;
  quirks: string[];
  examples: string[];
  notes?: string;
}

export interface CleanedEmail {
  text: string;
  recipientName?: string;
  greeting?: string;
  signoff?: string;
  isReply: boolean;
  internalDate: number;
}
