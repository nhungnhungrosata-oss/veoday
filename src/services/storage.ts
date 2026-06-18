import localforage from 'localforage';
import { GeneratedResult, STORAGE_KEY } from '../types';

export async function getHistory(): Promise<GeneratedResult[]> {
  const data = await localforage.getItem<GeneratedResult[]>(STORAGE_KEY);
  const list = Array.isArray(data) ? data : [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return list.filter((item) => item.timestamp > dayAgo).slice(0, 10);
}

export async function saveResult(result: GeneratedResult): Promise<void> {
  const old = await getHistory();
  await localforage.setItem(STORAGE_KEY, [result, ...old].slice(0, 10));
}
