import mammoth from 'mammoth';

/**
 * Recebe um Buffer de .docx, extrai texto e converte para um template de avaliação.
 * Heurísticas simples:
 *  - Linha com '____' vira campo de texto (input)
 *  - Blocos de opções identificados por padrões (a), b), (A), A., 1) etc) viram 'radio'
 *  - Perguntas terminadas em ':' ou '?' iniciam um novo bloco até a próxima pergunta
 */
export async function parseDocxToTemplate(buffer) {
  const { value: text } = await mammoth.extractRawText({ buffer });
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  /** Estrutura final: { questions: [ { id, type, prompt, options? } ] } */
  const questions = [];
  let current = null;
  let optionBuffer = [];

  const isOption = (line) => {
    // Exemplos: "a) ....", "(a) ...", "A) ...", "1) ...", "- opção ...", "• ..."
    return /^([\(\[]?[A-Za-z0-9][\)\].-])\s+/.test(line) || /^[-•]\s+/.test(line);
  };
  const endsWithAnswerLine = (line) => /_{3,}|_{2,}|_{5,}|_{10,}|_{15,}/.test(line) || /_{2,}/.test(line.replace(/\s+/g,''));
  const isQuestionStart = (line) => /[:?]$/.test(line) && !isOption(line);

  const pushCurrentIfAny = () => {
    if (!current) return;
    if (optionBuffer.length) {
      current.type = 'radio';
      current.options = optionBuffer.map(s => s.replace(/^([\(\[]?[A-Za-z0-9][\)\].-])\s+/, '').replace(/^[-•]\s+/, '').trim()).filter(Boolean);
    }
    questions.push(current);
    current = null;
    optionBuffer = [];
  };

  lines.forEach(line => {
    if (isQuestionStart(line)) {
      // Começa uma nova pergunta
      pushCurrentIfAny();
      current = { id: cryptoRandomId(), type: 'text', prompt: line };
    } else if (isOption(line)) {
      if (!current) {
        // Se vier opções antes de iniciar pergunta, criamos uma genérica
        current = { id: cryptoRandomId(), type: 'radio', prompt: 'Selecione uma opção:' };
      }
      optionBuffer.push(line);
    } else if (endsWithAnswerLine(line)) {
      // Linha com traço/underscore => campo de texto, mantendo o enunciado
      pushCurrentIfAny();
      const prompt = line.replace(/_{2,}/g, '__________'); // mantém o visual no preview
      current = { id: cryptoRandomId(), type: 'text', prompt };
      pushCurrentIfAny();
    } else {
      // Linha normal: se já existe pergunta em construção sem opções, anexamos ao prompt
      if (current && current.type === 'text' && !optionBuffer.length) {
        current.prompt += ' ' + line;
      } else {
        // caso solto: inicia pergunta simples
        pushCurrentIfAny();
        current = { id: cryptoRandomId(), type: 'text', prompt: line };
      }
    }
  });
  pushCurrentIfAny();
  return { questions };
}

function cryptoRandomId() {
  // gera ID curto
  return Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6);
}