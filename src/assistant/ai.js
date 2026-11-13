// Ba bộ não: Claude (làm việc), GPT (phản biện), Gemini (trọng tài).
// Claude gọi qua SDK chính thức @anthropic-ai/sdk. GPT và Gemini gọi thẳng REST API (không cần thêm thư viện).
// Kiểm thử thay các hàm trong object `ai` bằng hàm giả.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client = null;
function anthropic() {
  if (!config.assistant.anthropicKey) throw new Error('Thiếu ANTHROPIC_API_KEY trong .env');
  client ??= new Anthropic({ apiKey: config.assistant.anthropicKey, maxRetries: 3 });
  return client;
}

async function postJson(url, headers, body, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label} lỗi ${res.status}: ${data?.error?.message || ''}`.trim());
  return data;
}

// Lấy chữ trong kết quả Claude (bỏ qua khối thinking, tool_use...).
export function claudeTextOf(message) {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Tìm và đọc khối JSON đầu tiên trong chuỗi; trả {} nếu không đọc được.
export function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try {
    const v = JSON.parse(m ? m[0] : text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const ai = {
  // Gọi Messages API, trả về Message của SDK.
  async claude(params) {
    return anthropic().messages.create({ model: config.assistant.claudeModel, ...params });
  },

  // Claude 1 lượt, không công cụ.
  async claudeText(system, prompt, { maxTokens = 8000, effort = 'medium' } = {}) {
    const msg = await ai.claude({
      max_tokens: maxTokens,
      system,
      output_config: { effort },
      messages: [{ role: 'user', content: prompt }],
    });
    if (msg.stop_reason === 'refusal') return '';
    return claudeTextOf(msg);
  },

  // GPT phản biện (OpenAI Responses API).
  async gptText(system, prompt) {
    const key = config.assistant.openaiKey;
    if (!key) throw new Error('Thiếu OPENAI_API_KEY');
    const data = await postJson(
      'https://api.openai.com/v1/responses',
      { Authorization: `Bearer ${key}` },
      { model: config.assistant.openaiModel, instructions: system, input: prompt },
      'OpenAI',
    );
    if (typeof data.output_text === 'string') return data.output_text.trim();
    return (data.output || [])
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('')
      .trim();
  },

  // Gemini trọng tài, trả về object JSON.
  async geminiJson(system, prompt) {
    const key = config.assistant.geminiKey;
    if (!key) throw new Error('Thiếu GEMINI_API_KEY');
    const model = encodeURIComponent(config.assistant.geminiModel);
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': key },
      {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      },
      'Gemini',
    );
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return parseJson(text);
  },
};
