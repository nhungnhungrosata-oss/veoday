export type VoiceType = "Bắc" | "Trung" | "Nam";
export type VideoModelType = "Veo 3" | "Gork";
export type StyleType = "energy" | "professional" | "gentle" | "natural";

export interface AppState {
  images: string[];
  selectedImageIndex: number | null;
  content: string;
  notes: string;
  sceneCount: number;
  voice: VoiceType;
  style: StyleType;
  videoModel: VideoModelType;
}

export interface ScriptScene {
  videoPrompt: string;
  voiceScript: string;
}

export interface ThumbnailVariation {
  text: string;
  gradient?: string;
  styleClass?: string;
}

export interface GeneratedResult {
  id: string;
  timestamp: number;
  hook: string;
  hashtags: string[];
  scenes: ScriptScene[];
  thumbnailVariations: ThumbnailVariation[];
  inputs: AppState;
}

export const STORAGE_KEY = "brand_video_scripts_v1";
