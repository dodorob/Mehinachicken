(function(root, factory) {
  'use strict';
  var exported = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else if (root) root.AccountingReportBrowser = exported.create(root.pdfjsDistBuildPdf, root.AccountingReportParser, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function dataUrlToBytes(dataUrl, runtime) {
    var encoded = String(dataUrl || '').replace(/^data:application\/pdf;base64,/, '');
    if (!encoded) throw new Error('PDF-Daten fehlen.');
    var binary = runtime.atob(encoded);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function requireDependency(value, message) {
    if (!value) throw new Error(message);
    return value;
  }

  function create(pdfjs, parser, runtime) {
    var browserRuntime = runtime || (typeof globalThis !== 'undefined' ? globalThis : null);
    return {
      async extractAccountingReport(originalFileB64) {
        var pdfLibrary = requireDependency(pdfjs, 'Die lokale PDF-Bibliothek konnte nicht geladen werden.');
        var reportParser = requireDependency(parser, 'Der Buchhaltungsreport-Parser konnte nicht geladen werden.');
        requireDependency(reportParser.reconstructLayoutPage, 'Die PDF-Layoutrekonstruktion ist nicht verfügbar.');
        requireDependency(reportParser.parseFinancialAccountingReportText, 'Der Buchhaltungsreport-Parser ist nicht verfügbar.');
        requireDependency(browserRuntime && browserRuntime.atob, 'Der Browser kann Base64-PDF-Daten nicht dekodieren.');

        // A worker loaded from file:// is blocked by several browsers. Parsing on the
        // current thread keeps the ZIP/double-click workflow completely local.
        pdfLibrary.disableWorker = true;
        var loadingTask = pdfLibrary.getDocument({ data: dataUrlToBytes(originalFileB64, browserRuntime) });
        var documentHandle = await (loadingTask.promise || loadingTask);
        var pages = [];
        try {
          for (var pageNumber = 1; pageNumber <= documentHandle.numPages; pageNumber += 1) {
            var page = await documentHandle.getPage(pageNumber);
            var textContent = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
            pages.push(reportParser.reconstructLayoutPage(textContent.items));
          }
          return {
            ok: true,
            parsed: reportParser.parseFinancialAccountingReportText(pages.join('\n\n')),
            pages: documentHandle.numPages,
          };
        } finally {
          if (documentHandle && typeof documentHandle.destroy === 'function') documentHandle.destroy();
        }
      },
    };
  }

  return { create: create, dataUrlToBytes: dataUrlToBytes };
});
