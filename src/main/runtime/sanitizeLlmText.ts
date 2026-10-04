/** Remove model reasoning and textual imitations of tool calls before text reaches UI or speech. */
export function sanitizeLlmText(content: string | null | undefined): string {
  let text = (content ?? '').replace(/```\s*tool_code\b[\s\S]*?```/gi, '');
  // Some providers put the entire tool/reasoning preamble on the same line as the answer.
  text = text.replace(/\btool_code\b[\s\S]*?(?=\bthought\b|\[bubble:|\r?\n|$)/gi, '');
  text = text.replace(/\bprint\(\s*default_api\.[\s\S]*?(?=\bthought\b|\[bubble:|\r?\n|$)/gi, '');
  text = text.replace(/(^|\r?\n)\s*(?:thought|reasoning|analysis)\b\s*:?\s*[^\r\n]*?(?=\[bubble:|\r?\n|$)/gi, '$1');
  text = text.split(/\r?\n/).filter(line => !/^\s*(?:```\s*tool_code|tool_code\b|print\(\s*default_api\.|thought\b|reasoning\b|analysis\b)/i.test(line)).join('\n');
  const bubble = /\[bubble:\s*[^\]\r\n]*\]/i.exec(text);
  if (bubble) text = text.slice(bubble.index);
  return text.trim();
}

/** Recover a mood report emitted as text; callers still validate it through the normal executor. */
export function pseudoMoodArgs(content: string | null | undefined): Record<string, unknown> | undefined {
  const call = /(?:default_api\.)?report_user_mood\s*\(([^\r\n]*?)\)/i.exec(content ?? '');
  if (!call) return undefined;
  const args = call[1]!;
  const mood = /\bmood\s*=\s*['"]([^'"]+)['"]/i.exec(args)?.[1];
  const intensity = /\bintensity\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(args)?.[1];
  const reason = /\breason\s*=\s*(['"])(.*?)\1/i.exec(args)?.[2] ?? '';
  if (!mood || intensity === undefined) return undefined;
  return { mood, intensity: Number(intensity), reason };
}
