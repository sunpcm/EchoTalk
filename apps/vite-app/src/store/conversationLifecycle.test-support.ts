import { vi } from "vitest";
import * as platform from "@/platform";
import type {
  AppStateSource,
  LifecycleOptions,
  PlatformType,
  WebLifecycleOptions,
} from "@/platform";

/** 在模块加载时缓存真实实现，避免后续 vi.spyOn 替换后丢失委托目标。 */
const actualCreateLifecycleAdapter = platform.createLifecycleAdapter;

/** 本轮 fixture 安装的 spy，供同一测试内重复 install 时先恢复旧 spy。 */
let installedSpies: Array<ReturnType<typeof vi.spyOn>> = [];

function restoreInstalledSpies(): void {
  for (const spy of installedSpies) {
    spy.mockRestore();
  }
  installedSpies = [];
}

export interface FakeAppStateSource extends AppStateSource {
  getState: ReturnType<typeof vi.fn<() => Promise<{ isActive: boolean }>>>;
  addListener: ReturnType<
    typeof vi.fn<
      (
        eventName: "appStateChange",
        listenerFunc: (state: { isActive: boolean }) => void,
      ) => Promise<{ remove(): Promise<void> }>
    >
  >;
  emitAppStateChange(state: { isActive: boolean }): void;
  removeMock: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

export function createFakeApp(initialActive = true): FakeAppStateSource {
  let callback: ((state: { isActive: boolean }) => void) | undefined;
  const removeMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const addListener = vi.fn<
    (
      eventName: "appStateChange",
      listenerFunc: (state: { isActive: boolean }) => void,
    ) => Promise<{ remove(): Promise<void> }>
  >((_eventName: "appStateChange", listenerFunc: (state: { isActive: boolean }) => void) => {
    callback = listenerFunc;
    return Promise.resolve({ remove: removeMock });
  });
  const getState = vi.fn<() => Promise<{ isActive: boolean }>>().mockResolvedValue({
    isActive: initialActive,
  });

  return {
    getState,
    addListener,
    removeMock,
    emitAppStateChange(state: { isActive: boolean }) {
      callback?.(state);
    },
  };
}

export interface PlatformLifecycleController {
  setPlatform(platform: PlatformType): void;
  setApp(app?: AppStateSource): void;
  setWebOptions(webOptions?: WebLifecycleOptions): void;
  detectPlatformMock: ReturnType<typeof vi.spyOn>;
  createLifecycleAdapterMock: ReturnType<typeof vi.spyOn>;
}

/**
 * 以真实 Native/Web adapter 为底，仅把 platform 身份与 app/webOptions 从测试边界注入。
 * 产品代码的 isNativeIos() 通过 detectPlatform() 严格判 ios，不读取 adapter capabilities。
 */
export function installPlatformLifecycle(options?: {
  platform?: PlatformType;
  app?: AppStateSource;
  webOptions?: WebLifecycleOptions;
}): PlatformLifecycleController {
  restoreInstalledSpies();

  let currentPlatform: PlatformType = options?.platform ?? "web";
  let currentApp: AppStateSource | undefined = options?.app;
  let currentWebOptions: WebLifecycleOptions | undefined = options?.webOptions;

  const detectSpy = vi.spyOn(platform, "detectPlatform").mockImplementation(() => currentPlatform);
  const createSpy = vi
    .spyOn(platform, "createLifecycleAdapter")
    .mockImplementation((lifecycleOptions?: LifecycleOptions) =>
      actualCreateLifecycleAdapter({
        ...lifecycleOptions,
        platform: currentPlatform,
        app: currentApp ?? lifecycleOptions?.app,
        webOptions: currentWebOptions ?? lifecycleOptions?.webOptions,
      }),
    );
  installedSpies.push(detectSpy, createSpy);

  return {
    setPlatform(platform: PlatformType) {
      currentPlatform = platform;
    },
    setApp(app?: AppStateSource) {
      currentApp = app;
    },
    setWebOptions(webOptions?: WebLifecycleOptions) {
      currentWebOptions = webOptions;
    },
    detectPlatformMock: detectSpy,
    createLifecycleAdapterMock: createSpy,
  };
}
