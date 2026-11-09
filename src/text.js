// Chuẩn hóa tiếng Việt để so khớp lệnh: chữ thường, bỏ dấu, đ -> d.
export function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_WORDS = {
  mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10,
};

// Tìm số lượng đứng trước chữ "video" (vd "10 video", "muoi video"). Trả về null nếu không có.
export function countBefore(norm, word = 'video') {
  const m = norm.match(new RegExp(`(\\d+|${Object.keys(NUMBER_WORDS).join('|')})\\s+(?:cai\\s+|clip\\s+)?${word}`));
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
}
