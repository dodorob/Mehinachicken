# PDF.js browser runtime

`pdf.js` and `pdf.worker.js` are the browser builds of Mozilla PDF.js 1.10.100
(Apache-2.0), taken from the version bundled with the project's `pdf-parse`
dependency. PDF.js needs both runtime parts, but Mehinachicken loads the worker
build as a normal local script and disables actual Web Worker creation. Parsing
therefore stays on the current thread and also works when `index.html` is opened
directly through `file://`.
