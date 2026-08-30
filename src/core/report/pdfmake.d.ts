// @types/pdfmake describes the classic 0.2 browser entry; pdfmake 0.3's promise-based
// getBuffer() and the virtual-file-system registration are typed here instead.

declare module "pdfmake/build/pdfmake" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface CreatedPdf {
    getBuffer(): Promise<Uint8Array>;
  }

  const pdfMake: {
    createPdf(definition: TDocumentDefinitions): CreatedPdf;
    addVirtualFileSystem(vfs: Record<string, string>): void;
    addFonts(fonts: Record<string, Record<string, string>>): void;
  };
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const vfs: Record<string, string>;
  export default vfs;
}
