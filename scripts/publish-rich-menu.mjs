import { readFile } from "node:fs/promises";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) {
  throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required");
}

const menu = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: `Heisenberg Developer Menu ${new Date().toISOString()}`,
  chatBarText: "เมนูหลัก",
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: {
        type: "message",
        label: "ดู Code ใน Repo",
        text: "ดู Code ใน Repo",
      },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: {
        type: "message",
        label: "อ่านข้อมูลบน Database",
        text: "อ่านข้อมูลบน Database",
      },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: {
        type: "message",
        label: "ตรวจสอบหน้า UI",
        text: "ตรวจสอบหน้า UI",
      },
    },
  ],
};

const headers = {
  Authorization: `Bearer ${token}`,
};

let richMenuId;
try {
  const createResponse = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(menu),
  });
  const created = await responseJson(createResponse, "create rich menu");
  richMenuId = created.richMenuId;

  const image = await readFile(new URL("../assets/rich-menu.png", import.meta.url));
  const uploadResponse = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "image/png" },
      body: image,
    },
  );
  await responseOk(uploadResponse, "upload rich menu image");

  const defaultResponse = await fetch(
    `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`,
    { method: "POST", headers },
  );
  await responseOk(defaultResponse, "set default rich menu");

  const verifyResponse = await fetch(
    "https://api.line.me/v2/bot/user/all/richmenu",
    { headers },
  );
  const verified = await responseJson(verifyResponse, "verify default rich menu");
  if (verified.richMenuId !== richMenuId) {
    throw new Error("Default rich menu verification did not match");
  }

  console.log(`Published default rich menu: ${richMenuId}`);
} catch (error) {
  if (richMenuId) {
    await fetch(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, {
      method: "DELETE",
      headers,
    }).catch(() => undefined);
  }
  throw error;
}

async function responseOk(response, operation) {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`${operation} failed (${response.status}): ${detail}`);
  }
}

async function responseJson(response, operation) {
  await responseOk(response, operation);
  return response.json();
}
