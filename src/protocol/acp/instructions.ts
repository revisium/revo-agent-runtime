const openingDelimiter = '<<<REVO_INSTRUCTIONS>>>';
const closingDelimiter = '<<<END_REVO_INSTRUCTIONS>>>';

/** The documented prefix contract: delimited instructions, blank line, then the caller prompt. */
export const prefixInstructions = (prompt: string, instructions: string): string =>
  `${openingDelimiter}\n${instructions}\n${closingDelimiter}\n\n${prompt}`;
