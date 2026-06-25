declare module "pptx2json" {
  export function parseAsync(buf: Buffer): Promise<{ slides: Array<{ shapes?: Array<{ text?: string }> }> }>;
}
