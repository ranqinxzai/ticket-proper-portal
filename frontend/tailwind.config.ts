import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          ink: "hsl(var(--primary-ink))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // `rounded-xl` is the panel radius on ~65 hand-built cards. Classic keeps
        // Tailwind's 0.75rem (globals.css :root); Modern flattens it to 0.5rem.
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      // Agent-chrome geometry. The values live in globals.css as CSS variables
      // (comfortable vs compact density), so the header height, <main> gutters and
      // every sticky offset that depends on them move together. `rail` is a
      // calc here, not a variable: a derived variable defined at :root would not
      // pick up the compact overrides.
      spacing: {
        header: "var(--header-h)",
        "main-x": "var(--main-px)",
        "main-y": "var(--main-py)",
        sidebar: "var(--sidebar-w)",
        rail: "calc(var(--header-h) + var(--main-py))",
        // Modern icon rail width (56px). `rail` above is the sticky offset under the
        // header, hence the different name.
        "nav-rail": "var(--rail-w)",
      },
      boxShadow: {
        // Values live in globals.css (:root = Classic; Modern sets them to none so
        // in-page panels go flat). `0 0 #0000`, never `none`: Tailwind composes
        // box-shadow from --tw-shadow and `none` inside that list is invalid.
        soft: "var(--shadow-soft)",
        "soft-md": "var(--shadow-soft-md)",
        "soft-lg":
          "0 4px 6px -2px rgb(16 24 40 / 0.05), 0 12px 16px -4px rgb(16 24 40 / 0.10)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // `compact:` — applies only when the user picked Compact density AND the
    // element sits inside the agent app (AgentShell / WorkspaceChrome carry
    // data-shell="agent"). Specificity is 0,3,0, so it beats sm:/lg:/hover:
    // utilities: use `compact:lg:` only for breakpoint-gated layout (grid-cols,
    // flex-row, hidden). Never use it inside components/ui/* primitives (it would
    // beat consumer overrides); primitives read the CSS variables instead. It has
    // no effect inside portaled popovers/dialogs (they render under <body>).
    plugin(({ addVariant }) => {
      addVariant("compact", ':is([data-density="compact"] [data-shell="agent"] &)');
      // `modern:` — applies only when the user picked the Modern interface AND the
      // page is an agent-app route (<html data-app="agent" data-ui="modern">, set by
      // DENSITY_SCRIPT / AgentShell). Specificity 0,3,0 like `compact:`. Classic is
      // the absence of the attribute, so a `modern:` utility can never change it.
      addVariant("modern", ':is(html[data-app="agent"][data-ui="modern"] &)');
    }),
  ],
} satisfies Config;
