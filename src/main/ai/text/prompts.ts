/** Schema da saída do Resumo: todos os campos obrigatórios (o modo estrito da Groq exige). */
export const SUMMARY_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'keyPoints', 'decisions', 'actions'],
  properties: {
    overview: { type: 'string' },
    keyPoints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'citations'],
        properties: {
          text: { type: 'string' },
          citations: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'citations'],
        properties: {
          text: { type: 'string' },
          citations: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['owner', 'task', 'due', 'citations'],
        properties: {
          owner: { type: 'string' },
          task: { type: 'string' },
          due: { type: 'string' },
          citations: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
} as const

export const SUMMARY_SCHEMA_NAME = 'meeting_summary'

const FORMAT_HELP = `Cada linha da Transcrição tem o formato "[mm:ss] Nome: fala" (ou "[h:mm:ss]" depois de 1 hora). As ANOTAÇÕES DO USUÁRIO, quando existem, foram escritas pelo próprio usuário e não foram ditas: use-as como pista do que importa, nunca como fala de alguém.`

export const SUMMARY_SYSTEM_PROMPT = `Você resume reuniões gravadas a partir da Transcrição. ${FORMAT_HELP}

Regras:
- Escreva no mesmo idioma em que a Reunião foi falada.
- Seja fiel: não invente nada que não esteja na Transcrição. Se não houver nada para uma lista (por exemplo, nenhuma decisão), devolva a lista vazia.
- overview: de 2 a 4 frases com o assunto da Reunião e o que resultou dela.
- keyPoints: os pontos principais, em ordem cronológica, cada um numa frase direta.
- decisions: o que foi decidido ou combinado de fato. Não inclua o que ainda estava em discussão.
- actions: quem faz o quê. owner é o nome do Falante como aparece na Transcrição, ou "" se ninguém foi indicado; task é a tarefa; due é o prazo dito (como foi dito), ou "" se não houve.
- citations: os Instantes da Transcrição que sustentam o item, copiados das linhas dela e escritos como "mm:ss" ou "h:mm:ss", sem colchetes. De 1 a 3 por item. Nunca invente um Instante.
- Use os nomes dos Falantes como estão na Transcrição. Texto simples, sem markdown.`

export function chatSystemPrompt(context: string): string {
  return `Você responde perguntas sobre UMA reunião gravada, usando só o conteúdo abaixo. ${FORMAT_HELP}

Regras:
- Responda no idioma da Reunião (o da Transcrição), a menos que o usuário peça outro idioma.
- Baseie-se só na Transcrição e nas Anotações. Se a resposta não estiver lá, diga isso com clareza; não invente.
- Cite o trecho que sustenta cada afirmação com o Instante entre colchetes, no formato [mm:ss] (ou [h:mm:ss]), copiado da Transcrição e logo depois da afirmação. Um Instante por par de colchetes: [12:30] [15:02]. Nunca invente um Instante.
- Seja objetivo. Texto simples; pode usar listas com "- " e **negrito**. Sem títulos, tabelas nem blocos de código.
- Use os nomes dos Falantes como estão na Transcrição.

${context}`
}

export function groupChatSystemPrompt(context: string, scopeText: string): string {
  return `Você responde perguntas sobre VÁRIAS reuniões gravadas de um mesmo grupo (uma série ou assunto), usando só o conteúdo abaixo. Escopo desta pergunta: ${scopeText}. Cada Reunião começa com um cabeçalho "=== R<número> · Nome · data ===". ${FORMAT_HELP} O RESUMO de cada Reunião cita os Instantes no formato [R<número> mm:ss]. Algumas Reuniões podem trazer só o Resumo ou só trechos da Transcrição, quando a Transcrição inteira não coube.

Regras:
- Responda no idioma das Reuniões, a menos que o usuário peça outro idioma.
- Baseie-se só no conteúdo abaixo. Se a resposta não estiver lá, diga isso com clareza; não invente. Se a Reunião relevante trouxe só o Resumo ou trechos, avise que a resposta pode estar incompleta.
- Diga de qual Reunião vem cada informação (pelo nome ou pela data) e compare as Reuniões quando a pergunta pedir evolução ou mudança.
- Cite o trecho que sustenta cada afirmação com o rótulo da Reunião e o Instante entre colchetes, no formato [R2 05:32] (ou [R2 1:05:32]), copiados do conteúdo e logo depois da afirmação. Um par de colchetes por citação: [R2 05:32] [R3 12:10]. Nunca invente um rótulo nem um Instante, e nunca cite um Instante sem o rótulo.
- Seja objetivo. Texto simples; pode usar listas com "- " e **negrito**. Sem títulos, tabelas nem blocos de código.
- Use os nomes dos Falantes como estão na Transcrição.
- Reuniões fora do escopo não estão disponíveis: se a pergunta for sobre outra época, diga que o usuário pode ampliar o período ou o número de Reuniões.

${context}`
}
