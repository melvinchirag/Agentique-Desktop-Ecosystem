/** Status details contain fixed actions and counts only. Never pass outside text here. */
export const PIXEL_STATUS = {
  sortingLetters: (count: number): string => `Sorting ${safeCount(count)} new letters…`,
  readingThread: (count: number): string => `Reading a thread (${safeCount(count)} messages)…`,
  checkingStyle: 'Checking how you write…',
  writingDraft: 'Writing in your voice…',
  checkingCalendar: 'Checking your calendar…',
  searchingDrive: 'Searching Drive…',
  writingReport: 'Writing your report…',
  learningStyle: (done: number, total: number): string => `Learning how you write… ${safeCount(done)}/${safeCount(total)}`,
} as const;

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
