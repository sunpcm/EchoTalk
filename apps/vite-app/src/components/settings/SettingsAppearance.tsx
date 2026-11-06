import type { ThemeName } from "@/store/settings";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.settings;

const THEME_SWATCHES: { value: ThemeName; label: string; bg: string; accent: string }[] = [
  { value: "warm", label: t.themeWarm, bg: "#FBF7F1", accent: "#F76B4A" },
  { value: "cool", label: t.themeCool, bg: "#F1F5FB", accent: "#3D6FE0" },
  { value: "dark", label: t.themeDark, bg: "#17181B", accent: "#E8A23D" },
];

interface SettingsAppearanceProps {
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
}

/** 外观主题保持 local-first；持久化语义仍由 settings store 所有。 */
export function SettingsAppearance({ theme, onThemeChange }: SettingsAppearanceProps) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-text-default text-sm font-medium">{t.themeTitle}</p>
        <p className="text-text-muted text-xs">{t.themeDesc}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t.themeTitle}>
        {THEME_SWATCHES.map((swatch) => {
          const active = theme === swatch.value;
          return (
            <button
              key={swatch.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${swatch.label}${t.themeTitle}`}
              onClick={() => onThemeChange(swatch.value)}
              className={`flex min-h-[44px] min-w-[44px] flex-1 items-center justify-center gap-2 rounded-[14px] border-2 px-3 py-2.5 transition-colors ${
                active ? "border-accent" : "border-border-default hover:border-accent-soft-border"
              }`}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ background: swatch.bg, border: `2px solid ${swatch.accent}` }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: swatch.accent }} />
              </span>
              <span className="text-text-default text-sm font-semibold">{swatch.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
