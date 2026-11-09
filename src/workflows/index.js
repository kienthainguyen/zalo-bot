// Danh sách luồng. Thêm luồng mới: tạo file trong thư mục này (xem edit-tea.js làm mẫu)
// rồi thêm vào mảng dưới. Mỗi luồng có: id, title, examples, match(text), validate?(params), start(job).
import editTea from './edit-tea.js';
import explainer from './explainer.js';

export const workflows = [explainer, editTea];
