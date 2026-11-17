/** The navy-and-gold frame around the sign-in, setup and invite screens. */
export function AuthShell({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-navy px-4 py-10">
      <div className="mb-6 flex items-baseline gap-0.5 font-serif text-[34px] text-white">
        RealtyNiti
        <span className="inline-block size-2 rounded-full bg-gold" />
      </div>
      <div className="w-full max-w-[400px] rounded-2xl bg-surface p-6 shadow-lift sm:p-7">
        <h1 className="font-serif text-[30px] leading-tight text-ink">{title}</h1>
        {intro && <div className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{intro}</div>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  placeholder,
  inputMode,
  defaultValue,
  required = true,
  autoFocus,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  inputMode?: "tel" | "text";
  defaultValue?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        inputMode={inputMode}
        defaultValue={defaultValue}
        required={required}
        autoFocus={autoFocus}
        className="input h-11 text-[15px]"
      />
    </div>
  );
}
