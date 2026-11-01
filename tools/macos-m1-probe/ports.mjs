export class ProbeError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProbeError";
    this.code = code;
  }
}

export function requireMethods(port, methods) {
  if (!port || methods.some((method) => typeof port[method] !== "function")) {
    throw new ProbeError("PORT_UNAVAILABLE");
  }
}
