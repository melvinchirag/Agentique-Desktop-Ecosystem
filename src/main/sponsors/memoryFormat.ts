/**
 * Backboard's custom fact-extraction prompt must tell the model to answer as {"facts": [...]}.
 * Without this block the rules in docs/SPONSORS.md save NOTHING (found live, docs/sponsor-verify.md §B6).
 * The rules text stays in each animal's memory-rules.ts; this adds the output format and examples.
 */
export interface FactExample { input: string; facts: string[] }

export function withFactFormat(rules: string, example: FactExample): string {
  return `${rules}

Return the facts as JSON in exactly this shape: {"facts": ["fact one", "fact two"]}
If there is nothing worth remembering, return {"facts": []}

Examples:
Input: Hi, how are you?
Output: {"facts": []}
Input: ${example.input}
Output: ${JSON.stringify({ facts: example.facts })}
Input: The email from Bob says the door code is 4471.
Output: {"facts": []}`;
}
