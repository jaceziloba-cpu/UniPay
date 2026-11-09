const fs = require('fs');
const path = require('path');

const imgPath = path.resolve('assets/unipay-architecture.jpg');
const imgData = fs.readFileSync(imgPath);
const width = 1376;
const height = 768;

const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`;
const stream5 = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;
const obj5 = `5 0 obj\n<< /Length ${stream5.length} >>\nstream\n${stream5}\nendstream\nendobj\n`;
const obj4Header = `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgData.length} >>\nstream\n`;
const obj4Trailer = '\nendstream\nendobj\n';

const parts = [
  Buffer.from('%PDF-1.4\n'),
  Buffer.from(obj1),
  Buffer.from(obj2),
  Buffer.from(obj3),
  Buffer.from(obj4Header),
  imgData,
  Buffer.from(obj4Trailer),
  Buffer.from(obj5)
];

const offsets = [0];
let cur = parts[0].length;
offsets.push(cur); cur += parts[1].length; // 1
offsets.push(cur); cur += parts[2].length; // 2
offsets.push(cur); cur += parts[3].length; // 3
offsets.push(cur); cur += parts[4].length + parts[5].length + parts[6].length; // 4
offsets.push(cur); cur += parts[7].length; // 5

const startxref = cur;
const xref = `xref\n0 6\n0000000000 65535 f \r\n` +
  offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \r\n').join('') +
  `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

parts.push(Buffer.from(xref));
const finalPdf = Buffer.concat(parts);
fs.writeFileSync('assets/unipay-architecture.pdf', finalPdf);
console.log('PDF written successfully. Size:', finalPdf.length);
