// pdfmake 0.3 ships without types; the documents export uses a small part of it (documents/pdf.ts).
declare module 'pdfmake/build/pdfmake' {
  const pdfMake: unknown;
  export default pdfMake;
}
declare module 'pdfmake/build/vfs_fonts' {
  const vfs: Record<string, string>;
  export default vfs;
}
