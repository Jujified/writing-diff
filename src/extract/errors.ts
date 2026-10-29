/** An error whose message is written for the person who chose the file. */
export class ExtractError extends Error {}

export type Preview =
  | { type: 'html'; html: string }
  | { type: 'pdf'; pageCount: number; render: (container: HTMLElement) => void; destroy: () => void };
