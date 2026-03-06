const body1 = {
  detail: "会话不存在",
};

const body2 = {
  detail: {
    status: "not_ready",
    errors: {
      config: "自定义模式未验证通过。",
    },
  },
};

const body3 = {
  detail: [
    {
      loc: ["body", "mode"],
      msg: "field required",
      type: "value_error.missing",
    },
  ],
};

function parseError(resStatus: number, body: any) {
  let message = `请求失败: ${resStatus}`;
  if (typeof body.detail === "string") {
    message = body.detail;
  } else if (body.errors && typeof body.errors === "object") {
    message = (Object.values(body.errors)[0] as string) || message;
  } else if (typeof body.message === "string") {
    message = body.message;
  }
  return message;
}

console.log("String detail:", parseError(404, body1));
console.log("Health ready:", parseError(503, body2));
console.log("Validation error:", parseError(422, body3));
