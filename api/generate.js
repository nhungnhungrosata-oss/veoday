// Đường dẫn tệp: api/generate.js
// Mục đích: Tự động thử nhiều API Key Gemini, nếu tất cả đều lỗi thì dùng DeepSeek.
// Kết quả trả về luôn được giữ đúng chuẩn định dạng để bạn không cần sửa code ở nơi khác.

export default async function handler(req, res) {
  // 1. Chỉ cho phép các yêu cầu POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ hỗ trợ phương thức POST' });
  }

  // 2. Tìm nội dung yêu cầu (prompt) mà giao diện gửi lên
  let prompt = "";
  if (req.body.prompt) {
    prompt = req.body.prompt;
  } else if (req.body.contents && req.body.contents[0].parts[0].text) {
    prompt = req.body.contents[0].parts[0].text;
  } else {
    // Nếu không rõ định dạng, chuyển toàn bộ thành chuỗi
    prompt = JSON.stringify(req.body);
  }

  // 3. Gom tất cả các Key Gemini đã khai báo trên Vercel vào một danh sách
  // Hàm .filter(Boolean) sẽ tự động loại bỏ các Key bạn chưa nhập (bị trống)
  const GEMINI_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_API_KEY
  ].filter(Boolean);

  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

  // 4. Khai báo hàm để gọi Gemini
  const callGemini = async (apiKey) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // Luôn gửi định dạng chuẩn mà Gemini yêu cầu
    const payload = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    // Nếu Gemini báo lỗi (ví dụ: 429 quá hạn ngạch), ném lỗi ra ngoài để bắt
    if (!response.ok) {
      throw new Error(`Gemini Error: ${response.status}`);
    }
    return data; // Trả về kết quả đúng chuẩn Gemini
  };

  // 5. Khai báo hàm để gọi DeepSeek (dùng làm dự phòng)
  const callDeepSeek = async () => {
    if (!DEEPSEEK_KEY) {
      throw new Error("Không có DEEPSEEK_API_KEY");
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error("DeepSeek Error");
    }

    // BIẾN ĐỔI kết quả của DeepSeek thành định dạng giống hệt Gemini
    // Điều này giúp giao diện (frontend) của bạn vẫn hiểu được mà không cần sửa thêm code!
    const dsText = data.choices[0].message.content;
    return {
      candidates: [
        {
          content: {
            parts: [{ text: dsText }]
          }
        }
      ]
    };
  };

  // ==========================================
  // 6. QUÁ TRÌNH XOAY VÒNG KEY (THỰC THI CHÍNH)
  // ==========================================

  // Thử lần lượt từng Key Gemini
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    try {
      console.log(`Đang thử dùng Gemini Key số ${i + 1}...`);
      const result = await callGemini(GEMINI_KEYS[i]);
      
      // Nếu thành công, trả ngay kết quả về cho ứng dụng và dừng lại
      return res.status(200).json(result);
    } catch (error) {
      // Nếu lỗi (như hết hạn ngạch 429), bỏ qua và lặp để thử Key tiếp theo
      console.log(`Gemini Key số ${i + 1} bị lỗi. Đang chuyển Key...`);
    }
  }

  // 7. Nếu tất cả Gemini đều lỗi, chuyển sang dùng DeepSeek
  if (DEEPSEEK_KEY) {
    try {
      console.log(`Tất cả Gemini Key đều lỗi. Đang chuyển sang DeepSeek...`);
      const dsResult = await callDeepSeek();
      return res.status(200).json(dsResult);
    } catch (error) {
      console.log(`DeepSeek cũng gặp lỗi.`);
    }
  }

  // 8. Nếu chạy đến đây tức là TẤT CẢ các AI đều lỗi hoặc hết lượt
  return res.status(429).json({ 
    error: { 
      message: "Tất cả API Key dự phòng đều đã vượt quá hạn ngạch. Vui lòng quay lại sau.",
      status: "RESOURCE_EXHAUSTED"
    } 
  });
}
