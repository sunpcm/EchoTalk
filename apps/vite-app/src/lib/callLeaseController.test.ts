import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCallLeaseController,
  type CallLeaseControllerDeps,
  type CallLeaseResponse,
  type CallReleaseResponse,
  type CallLeaseSnapshot,
} from "./callLeaseController";

describe("CallLeaseController (CP-02 §10)", () => {
  const SESSION_A = "11111111-1111-4111-8111-111111111111";
  const SESSION_B = "22222222-2222-4222-8222-222222222222";
  const DEVICE_A = "33333333-3333-4333-8333-333333333333";
  const DEVICE_B = "44444444-4444-4444-8444-444444444444";

  let baseTime = 1_700_000_000_000;
  let isCurrentValue = true;

  function makeIso(offsetSeconds: number): string {
    return new Date(baseTime + offsetSeconds * 1000).toISOString();
  }

  function createMockDeps(overrides?: Partial<CallLeaseControllerDeps>): {
    deps: CallLeaseControllerDeps;
    claimMock: ReturnType<typeof vi.fn>;
    heartbeatMock: ReturnType<typeof vi.fn>;
    releaseMock: ReturnType<typeof vi.fn>;
    onChangeMock: ReturnType<typeof vi.fn>;
  } {
    const claimMock = vi.fn().mockImplementation(
      async (sessionId: string, deviceId: string): Promise<CallLeaseResponse> => ({
        session_id: sessionId,
        device_id: deviceId,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      }),
    );

    const heartbeatMock = vi.fn().mockImplementation(
      async (
        sessionId: string,
        owner: { device_id: string; generation: number },
      ): Promise<CallLeaseResponse> => ({
        session_id: sessionId,
        device_id: owner.device_id,
        generation: owner.generation,
        state: "held",
        expires_at: makeIso(90),
      }),
    );

    const releaseMock = vi.fn().mockImplementation(
      async (
        _sessionId: string,
        owner: { device_id: string; generation: number },
      ): Promise<CallReleaseResponse> => ({
        released: true,
        generation: owner.generation,
      }),
    );

    const onChangeMock = vi.fn<(snapshot: CallLeaseSnapshot) => void>();

    const deps: CallLeaseControllerDeps = {
      claim: claimMock,
      heartbeat: heartbeatMock,
      release: releaseMock,
      isCurrent: () => isCurrentValue,
      onChange: onChangeMock,
      now: () => baseTime,
      ...overrides,
    };

    return { deps, claimMock, heartbeatMock, releaseMock, onChangeMock };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    baseTime = 1_700_000_000_000;
    vi.setSystemTime(baseTime);
    isCurrentValue = true;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("模块无副作用与工厂纯洁性", () => {
    it("初始快照为 idle，无租约与 reason", () => {
      const { deps } = createMockDeps();
      const controller = createCallLeaseController(deps);

      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: null,
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("多次创建控制器互不干扰", () => {
      const { deps: deps1 } = createMockDeps();
      const { deps: deps2 } = createMockDeps();
      const c1 = createCallLeaseController(deps1);
      const c2 = createCallLeaseController(deps2);

      expect(c1.getSnapshot()).toEqual({ status: "idle", lease: null, reason: null });
      expect(c2.getSnapshot()).toEqual({ status: "idle", lease: null, reason: null });
    });
  });

  describe("正常 claim / 续期 / 释放", () => {
    it("成功 claim 后进入 held，并启动 20s 心跳和 90s 到期 watchdog", async () => {
      const { deps, claimMock, onChangeMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      const promise = controller.claim(SESSION_A, DEVICE_A);
      expect(controller.getSnapshot().status).toBe("claiming");

      await promise;

      expect(claimMock).toHaveBeenCalledWith(SESSION_A, DEVICE_A, false);
      expect(controller.getSnapshot()).toEqual({
        status: "held",
        lease: {
          session_id: SESSION_A,
          device_id: DEVICE_A,
          generation: 1,
          state: "held",
          expires_at: makeIso(90),
        },
        reason: null,
      });

      // 应当至少注册了心跳与 watchdog 两个定时器
      expect(vi.getTimerCount()).toBe(2);
      expect(onChangeMock).toHaveBeenCalled();
    });

    it("20s 心跳串行续期成功，更新 expires_at 并重排定时器", async () => {
      const { deps, heartbeatMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.claim(SESSION_A, DEVICE_A);

      // 时间前移 20 秒
      baseTime += 20_000;
      vi.setSystemTime(baseTime);

      heartbeatMock.mockResolvedValueOnce({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90), // 续期后的新过期时间
      });

      await vi.advanceTimersByTimeAsync(20_000);

      expect(heartbeatMock).toHaveBeenCalledTimes(1);
      expect(heartbeatMock).toHaveBeenCalledWith(SESSION_A, {
        device_id: DEVICE_A,
        generation: 1,
      });
      expect(controller.getSnapshot().status).toBe("held");
      expect(controller.getSnapshot().lease?.expires_at).toBe(makeIso(90));
      expect(vi.getTimerCount()).toBe(2);
    });

    it("成功 release 从 held 变为 idle，清空租约并取消定时器", async () => {
      const { deps, releaseMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.claim(SESSION_A, DEVICE_A);
      expect(vi.getTimerCount()).toBe(2);

      const releasePromise = controller.release();
      expect(controller.getSnapshot().status).toBe("releasing");
      expect(vi.getTimerCount()).toBe(0); // 立即取消定时器

      await releasePromise;

      expect(releaseMock).toHaveBeenCalledWith(SESSION_A, {
        device_id: DEVICE_A,
        generation: 1,
      });
      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: null,
      });
    });
  });

  describe("默认与显式接管参数", () => {
    it("未传 takeover 时默认为 false", async () => {
      const { deps, claimMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.claim(SESSION_A, DEVICE_A);
      expect(claimMock).toHaveBeenCalledWith(SESSION_A, DEVICE_A, false);
    });

    it("显式传 false 时原样传递 false", async () => {
      const { deps, claimMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.claim(SESSION_A, DEVICE_A, false);
      expect(claimMock).toHaveBeenCalledWith(SESSION_A, DEVICE_A, false);
    });

    it("显式传 true 时原样传递 true", async () => {
      const { deps, claimMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.claim(SESSION_A, DEVICE_A, true);
      expect(claimMock).toHaveBeenCalledWith(SESSION_A, DEVICE_A, true);
    });

    it("非布尔值 takeover 被拒绝，受控回 idle，reason=claim_failed", async () => {
      const { deps, claimMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      // @ts-expect-error 测试非法入参
      await controller.claim(SESSION_A, DEVICE_A, "true");
      expect(claimMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: "claim_failed",
      });
    });
  });

  describe("输入校验与错误隔离", () => {
    it("非法 sessionId UUID 不发请求，受控回 idle，reason=claim_failed", async () => {
      const { deps, claimMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.claim("invalid-uuid", DEVICE_A);
      expect(claimMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: "claim_failed",
      });
    });

    it("非法 deviceId UUID 不发请求，受控回 idle，reason=claim_failed", async () => {
      const { deps, claimMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.claim(SESSION_A, "not-a-uuid");
      expect(claimMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: "claim_failed",
      });
    });

    it("claim 响应与请求 tuple 不匹配时回退 idle，reason=claim_failed", async () => {
      const { deps, claimMock } = createMockDeps();
      claimMock.mockResolvedValueOnce({
        session_id: SESSION_B, // 不匹配
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      });

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: "claim_failed",
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("claim 响应 expires_at 已过期时拒绝成立租约，回退 idle", async () => {
      const { deps, claimMock } = createMockDeps();
      claimMock.mockResolvedValueOnce({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(-10), // 过去时间
      });

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: "claim_failed",
      });
    });
  });

  describe("在途去重与并发控制", () => {
    it("claiming 期间重复调用 claim 返回相同 promise，仅发送一次请求", async () => {
      const { deps, claimMock } = createMockDeps();
      let resolveClaim!: (res: CallLeaseResponse) => void;
      claimMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveClaim = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);
      const p1 = controller.claim(SESSION_A, DEVICE_A);
      const p2 = controller.claim(SESSION_A, DEVICE_A);

      expect(p1).toBe(p2);
      expect(claimMock).toHaveBeenCalledTimes(1);

      resolveClaim({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      });

      await Promise.all([p1, p2]);
      expect(controller.getSnapshot().status).toBe("held");
    });

    it("held 状态下调用 claim 不重复请求", async () => {
      const { deps, claimMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.claim(SESSION_A, DEVICE_A);
      expect(claimMock).toHaveBeenCalledTimes(1);

      await controller.claim(SESSION_A, DEVICE_A);
      expect(claimMock).toHaveBeenCalledTimes(1);
    });

    it("releasing 期间重复调用 release 返回相同 promise，仅发送一次请求", async () => {
      const { deps, releaseMock } = createMockDeps();
      let resolveRelease!: (res: CallReleaseResponse) => void;
      releaseMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRelease = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      const p1 = controller.release();
      const p2 = controller.release();

      expect(p1).toBe(p2);
      expect(releaseMock).toHaveBeenCalledTimes(1);

      resolveRelease({ released: true, generation: 1 });
      await Promise.all([p1, p2]);

      expect(controller.getSnapshot().status).toBe("idle");
    });

    it("idle 或 lost 状态下调用 release 不发送网络请求", async () => {
      const { deps, releaseMock } = createMockDeps();
      const controller = createCallLeaseController(deps);

      await controller.release();
      expect(releaseMock).not.toHaveBeenCalled();

      controller.invalidate();
      expect(controller.getSnapshot().status).toBe("lost");

      await controller.release();
      expect(releaseMock).not.toHaveBeenCalled();
    });
  });

  describe("心跳串行与独立到期 watchdog", () => {
    it("心跳网络挂起超过租约期限，独立 watchdog 准时到期转为 lost/expired", async () => {
      const { deps, heartbeatMock } = createMockDeps();
      // 心跳请求挂起不返回
      heartbeatMock.mockImplementation(() => new Promise(() => {}));

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      // 推进 20 秒：触发第一次心跳发送，挂起中
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(heartbeatMock).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot().status).toBe("held");

      // 继续推进 70 秒（总计 90 秒，达到 watchdog 到期点）
      baseTime += 70_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(70_000);

      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: "expired",
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("前次心跳未结束时，不发起下一次心跳（心跳串行）", async () => {
      const { deps, heartbeatMock } = createMockDeps();
      let resolveHeartbeat!: (res: CallLeaseResponse) => void;
      heartbeatMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveHeartbeat = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      // 推进 20 秒触发第 1 次心跳
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(heartbeatMock).toHaveBeenCalledTimes(1);

      // 前次未完成，再过 20 秒不应并发第 2 次
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(heartbeatMock).toHaveBeenCalledTimes(1);

      // 完成第 1 次心跳续期
      resolveHeartbeat({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      });
      await vi.advanceTimersByTimeAsync(1);

      // 下一个 20 秒才正常触发下一次心跳
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(heartbeatMock).toHaveBeenCalledTimes(2);
    });

    it("设备休眠唤醒越过期限时，发送前检查直接进入 lost/expired，不发请求", async () => {
      const { deps, heartbeatMock } = createMockDeps();
      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      // 直接跨越 100 秒（越过 90 秒 TTL）
      baseTime += 100_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(100_000);

      expect(heartbeatMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: "expired",
      });
    });
  });

  describe("失败后最终状态与用户显式重试", () => {
    it("claim 抛错受控回 idle，reason=claim_failed，允许用户显式重试并成功", async () => {
      const { deps, claimMock } = createMockDeps();
      claimMock.mockRejectedValueOnce(new Error("Network Error"));

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: "claim_failed",
      });

      // 用户显式再次 claim
      claimMock.mockResolvedValueOnce({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      });

      await controller.claim(SESSION_A, DEVICE_A);
      expect(controller.getSnapshot().status).toBe("held");
    });

    it("heartbeat 失败进入 lost，reason=heartbeat_failed，允许用户重新 claim", async () => {
      const { deps, heartbeatMock } = createMockDeps();
      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      heartbeatMock.mockRejectedValueOnce(new Error("409 call_lease_lost"));

      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);

      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: "heartbeat_failed",
      });
      expect(vi.getTimerCount()).toBe(0);

      // 从 lost 状态显式重获租约
      await controller.claim(SESSION_A, DEVICE_A);
      expect(controller.getSnapshot().status).toBe("held");
    });

    it("release 失败保留同 tuple 置 release_failed，禁止 claim，仅允许显式 release 重试", async () => {
      const { deps, releaseMock, claimMock } = createMockDeps();
      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      releaseMock.mockRejectedValueOnce(new Error("502 Bad Gateway"));
      await controller.release();

      expect(controller.getSnapshot()).toEqual({
        status: "release_failed",
        lease: {
          session_id: SESSION_A,
          device_id: DEVICE_A,
          generation: 1,
          state: "held",
          expires_at: makeIso(90),
        },
        reason: "release_failed",
      });

      // release_failed 状态下禁止 claim
      await controller.claim(SESSION_A, DEVICE_A);
      expect(claimMock).toHaveBeenCalledTimes(1); // 仅首次 claim

      // 显式重试 release
      releaseMock.mockResolvedValueOnce({ released: true, generation: 1 });
      await controller.release();

      expect(controller.getSnapshot()).toEqual({
        status: "idle",
        lease: null,
        reason: null,
      });
    });
  });

  describe("身份变化、失效与 dispose", () => {
    it("无当前身份时 claim 不发请求直接进入 lost", async () => {
      const { deps, claimMock } = createMockDeps();
      isCurrentValue = false;

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      expect(claimMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: null,
      });
    });

    it("claim 在途期间身份失效，结果作废进入 lost", async () => {
      const { deps, claimMock } = createMockDeps();
      let resolveClaim!: (res: CallLeaseResponse) => void;
      claimMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveClaim = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);
      const claimPromise = controller.claim(SESSION_A, DEVICE_A);

      // 异步期间身份失效
      isCurrentValue = false;

      resolveClaim({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      });

      await claimPromise;

      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: null,
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("heartbeat 发送前身份失效，取消定时器进入 lost", async () => {
      const { deps, heartbeatMock } = createMockDeps();
      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      // 准备触发心跳前身份失效
      isCurrentValue = false;
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);

      expect(heartbeatMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: null,
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("invalidate 立即取消定时器、清空 lease，转为 lost/invalidated，后允许重新 claim", async () => {
      const { deps } = createMockDeps();
      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      expect(vi.getTimerCount()).toBe(2);

      controller.invalidate();
      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: "invalidated",
      });
      expect(vi.getTimerCount()).toBe(0);

      // 从 lost 状态可以显式重新 claim
      await controller.claim(SESSION_A, DEVICE_A);
      expect(controller.getSnapshot().status).toBe("held");
    });

    it("dispose 清理状态并永久拒绝后续操作，且调用幂等", async () => {
      const { deps, claimMock, releaseMock } = createMockDeps();
      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      controller.dispose();
      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: "invalidated",
      });
      expect(vi.getTimerCount()).toBe(0);

      // 幂等重复 dispose
      controller.dispose();
      expect(controller.getSnapshot().status).toBe("lost");

      // 永久拒绝后续 claim 和 release
      await controller.claim(SESSION_A, DEVICE_A);
      expect(claimMock).toHaveBeenCalledTimes(1); // 仍是原先那次

      await controller.release();
      expect(releaseMock).not.toHaveBeenCalled();
    });
  });

  describe("迟到操作与代际隔离", () => {
    it("慢速 claim 在途时 invalidate 并重新 claim，慢速成功不得覆盖新 owner 且不自动 release", async () => {
      const { deps, claimMock, releaseMock } = createMockDeps();
      let resolveSlowClaim!: (res: CallLeaseResponse) => void;
      claimMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlowClaim = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);

      // 慢速 claim 1 启动
      const p1 = controller.claim(SESSION_A, DEVICE_A);

      // 外部作废
      controller.invalidate();
      expect(controller.getSnapshot().status).toBe("lost");

      // 启动 claim 2
      claimMock.mockResolvedValueOnce({
        session_id: SESSION_B,
        device_id: DEVICE_B,
        generation: 2,
        state: "held",
        expires_at: makeIso(90),
      });
      await controller.claim(SESSION_B, DEVICE_B);
      expect(controller.getSnapshot().lease?.session_id).toBe(SESSION_B);

      // 此时迟到的 claim 1 解决
      resolveSlowClaim({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      });
      await p1;

      // 确认新 owner 没被旧结果篡改
      expect(controller.getSnapshot().lease?.session_id).toBe(SESSION_B);
      expect(controller.getSnapshot().lease?.generation).toBe(2);

      // 契约明确规定：不得为迟到 claim 自动发 release
      expect(releaseMock).not.toHaveBeenCalled();
    });

    it("release 在途时 invalidate，迟到的 release 结果不得将状态回退到 idle", async () => {
      const { deps, releaseMock } = createMockDeps();
      let resolveRelease!: (res: CallReleaseResponse) => void;
      releaseMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRelease = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      const releasePromise = controller.release();
      expect(controller.getSnapshot().status).toBe("releasing");

      // 期间 invalidate
      controller.invalidate();
      expect(controller.getSnapshot().status).toBe("lost");

      // 迟到的 release 完成
      resolveRelease({ released: true, generation: 1 });
      await releasePromise;

      // 状态必须保持 lost，不得被改为 idle
      expect(controller.getSnapshot().status).toBe("lost");
    });
  });

  describe("CC-01 全局在途标记与代际隔离", () => {
    it("旧心跳挂起时不阻断 invalidate 后的新 owner 续期，且旧心跳结算不破坏新心跳标记", async () => {
      const { deps, claimMock, heartbeatMock } = createMockDeps();
      let resolveOldHeartbeat!: (res: CallLeaseResponse) => void;
      heartbeatMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldHeartbeat = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);

      // 1. claim deviceA (generation 7)
      claimMock.mockResolvedValueOnce({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 7,
        state: "held",
        expires_at: makeIso(90),
      });
      await controller.claim(SESSION_A, DEVICE_A);
      expect(controller.getSnapshot().lease?.generation).toBe(7);

      // 2. 20 秒后旧心跳发出，保持 pending
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(heartbeatMock).toHaveBeenCalledTimes(1);
      expect(heartbeatMock).toHaveBeenLastCalledWith(SESSION_A, {
        device_id: DEVICE_A,
        generation: 7,
      });

      // 3. invalidate 外部取消
      controller.invalidate();
      expect(controller.getSnapshot().status).toBe("lost");

      // 4. claim deviceB (generation 8) 成功
      claimMock.mockResolvedValueOnce({
        session_id: SESSION_B,
        device_id: DEVICE_B,
        generation: 8,
        state: "held",
        expires_at: makeIso(90),
      });
      await controller.claim(SESSION_B, DEVICE_B);
      expect(controller.getSnapshot().lease?.generation).toBe(8);

      // 5. 再过 20 秒，新 heartbeat 必须以 B/8 正常发出，不受未结算的旧心跳阻塞
      heartbeatMock.mockResolvedValueOnce({
        session_id: SESSION_B,
        device_id: DEVICE_B,
        generation: 8,
        state: "held",
        expires_at: makeIso(90),
      });
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);

      expect(heartbeatMock).toHaveBeenCalledTimes(2);
      expect(heartbeatMock).toHaveBeenLastCalledWith(SESSION_B, {
        device_id: DEVICE_B,
        generation: 8,
      });

      // 6. 此时旧心跳完成解决，不能破坏新 owner 的状态或定时器
      resolveOldHeartbeat({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 7,
        state: "held",
        expires_at: makeIso(90),
      });
      await vi.advanceTimersByTimeAsync(1);

      expect(controller.getSnapshot().status).toBe("held");
      expect(controller.getSnapshot().lease?.device_id).toBe(DEVICE_B);
      expect(controller.getSnapshot().lease?.generation).toBe(8);
    });

    it("watchdog 到期后新 claim 成功，旧挂起心跳迟到结算不污染新 lease 且不阻塞新心跳", async () => {
      const { deps, claimMock, heartbeatMock } = createMockDeps();
      let resolveOldHeartbeat!: (res: CallLeaseResponse) => void;
      heartbeatMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldHeartbeat = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      // 触发心跳并挂起
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);

      // 推进至 90 秒 watchdog 到期
      baseTime += 70_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(70_000);

      expect(controller.getSnapshot().status).toBe("lost");
      expect(controller.getSnapshot().reason).toBe("expired");

      // 用户显式重新 claim deviceB
      claimMock.mockResolvedValueOnce({
        session_id: SESSION_B,
        device_id: DEVICE_B,
        generation: 2,
        state: "held",
        expires_at: makeIso(90),
      });
      await controller.claim(SESSION_B, DEVICE_B);
      expect(controller.getSnapshot().status).toBe("held");

      // 此时旧心跳解决
      resolveOldHeartbeat({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      });
      await vi.advanceTimersByTimeAsync(1);

      // 保持新 lease，不被旧心跳改写
      expect(controller.getSnapshot().lease?.session_id).toBe(SESSION_B);

      // 新心跳能按时发出
      baseTime += 20_000;
      vi.setSystemTime(baseTime);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(heartbeatMock).toHaveBeenCalledTimes(2);
      expect(heartbeatMock).toHaveBeenLastCalledWith(SESSION_B, {
        device_id: DEVICE_B,
        generation: 2,
      });
    });

    it("旧 claim 的 finally 结算不得清理新 claim 的在途去重指针", async () => {
      const { deps, claimMock } = createMockDeps();
      let resolveClaim1!: (res: CallLeaseResponse) => void;
      claimMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveClaim1 = resolve;
          }),
      );

      const controller = createCallLeaseController(deps);

      // 启动 claim1 并挂起
      const p1 = controller.claim(SESSION_A, DEVICE_A);

      // 外部作废后启动 claim2 并挂起
      controller.invalidate();
      let resolveClaim2!: (res: CallLeaseResponse) => void;
      claimMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveClaim2 = resolve;
          }),
      );
      const p2 = controller.claim(SESSION_B, DEVICE_B);

      // 解决 claim1，其 finally 执行
      resolveClaim1({
        session_id: SESSION_A,
        device_id: DEVICE_A,
        generation: 1,
        state: "held",
        expires_at: makeIso(90),
      });
      await p1;

      // 此时 claim2 仍在途，再次调用 claim 应命中 claim2 的在途去重
      const p3 = controller.claim(SESSION_B, DEVICE_B);
      expect(p3).toBe(p2);
      expect(claimMock).toHaveBeenCalledTimes(2); // 仅 claim1 和 claim2

      resolveClaim2({
        session_id: SESSION_B,
        device_id: DEVICE_B,
        generation: 2,
        state: "held",
        expires_at: makeIso(90),
      });
      await Promise.all([p2, p3]);
      expect(controller.getSnapshot().status).toBe("held");
    });
  });

  describe("CC-02 实际写请求前的身份/取消检查缺口", () => {
    it("held 状态下 isCurrent=false 再调用 release：不得发起网络请求，必须清空 owner/定时器并进入 lost", async () => {
      const { deps, releaseMock } = createMockDeps();
      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);
      expect(controller.getSnapshot().status).toBe("held");
      expect(vi.getTimerCount()).toBe(2);

      // 身份失效
      isCurrentValue = false;

      await controller.release();

      expect(releaseMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual({
        status: "lost",
        lease: null,
        reason: null,
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("onChange 观察到 claiming 时同步 dispose：claim 网络请求不应发生", async () => {
      const controllerRef: { current: ReturnType<typeof createCallLeaseController> | null } = {
        current: null,
      };
      const { deps, claimMock } = createMockDeps({
        onChange: (snap) => {
          if (snap.status === "claiming") {
            controllerRef.current?.dispose();
          }
        },
      });

      const controller = createCallLeaseController(deps);
      controllerRef.current = controller;
      await controller.claim(SESSION_A, DEVICE_A);

      expect(claimMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot().status).toBe("lost");
      expect(controller.getSnapshot().reason).toBe("invalidated");
    });

    it("onChange 观察到 claiming 时同步 invalidate：claim 网络请求不应发生", async () => {
      const controllerRef: { current: ReturnType<typeof createCallLeaseController> | null } = {
        current: null,
      };
      const { deps, claimMock } = createMockDeps({
        onChange: (snap) => {
          if (snap.status === "claiming") {
            controllerRef.current?.invalidate();
          }
        },
      });

      const controller = createCallLeaseController(deps);
      controllerRef.current = controller;
      await controller.claim(SESSION_A, DEVICE_A);

      expect(claimMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot().status).toBe("lost");
      expect(controller.getSnapshot().reason).toBe("invalidated");
    });

    it("onChange 观察到 releasing 时同步 invalidate/dispose：release 网络请求不应发生", async () => {
      const controllerRef: { current: ReturnType<typeof createCallLeaseController> | null } = {
        current: null,
      };
      const { deps, releaseMock } = createMockDeps({
        onChange: (snap) => {
          if (snap.status === "releasing") {
            controllerRef.current?.invalidate();
          }
        },
      });

      const controller = createCallLeaseController(deps);
      controllerRef.current = controller;
      await controller.claim(SESSION_A, DEVICE_A);

      await controller.release();

      expect(releaseMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot().status).toBe("lost");
      expect(controller.getSnapshot().reason).toBe("invalidated");
    });

    it("onChange 观察到 releasing 时身份失效：release 网络请求不应发生，转为 lost", async () => {
      const { deps, releaseMock } = createMockDeps({
        onChange: (snap) => {
          if (snap.status === "releasing") {
            isCurrentValue = false;
          }
        },
      });

      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      await controller.release();

      expect(releaseMock).not.toHaveBeenCalled();
      expect(controller.getSnapshot().status).toBe("lost");
      expect(controller.getSnapshot().lease).toBeNull();
    });
  });

  describe("防御性快照与 observer 抛错隔离", () => {
    it("外部修改 getSnapshot 返回的对象不会影响内部状态", async () => {
      const { deps } = createMockDeps();
      const controller = createCallLeaseController(deps);
      await controller.claim(SESSION_A, DEVICE_A);

      const snap = controller.getSnapshot();
      expect(snap.lease?.generation).toBe(1);

      // 尝试篡改快照属性
      if (snap.lease) {
        snap.lease.generation = 999;
      }

      // 控制器内部不受影响
      expect(controller.getSnapshot().lease?.generation).toBe(1);
    });

    it("onChange 抛错不影响控制器状态迁移和异步操作结算", async () => {
      const { deps } = createMockDeps({
        onChange: () => {
          throw new Error("Observer UI Error");
        },
      });

      const controller = createCallLeaseController(deps);

      // claim 过程中 onChange 抛错，异步结算与状态不受影响
      await expect(controller.claim(SESSION_A, DEVICE_A)).resolves.toBeUndefined();
      expect(controller.getSnapshot().status).toBe("held");

      // release 过程中 onChange 抛错，异步结算与状态不受影响
      await expect(controller.release()).resolves.toBeUndefined();
      expect(controller.getSnapshot().status).toBe("idle");
    });
  });
});
