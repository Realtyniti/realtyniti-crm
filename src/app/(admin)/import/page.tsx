import { ImportForm } from "./form";

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Import existing leads</h1>
      <p className="text-sm text-stone-600">
        Bring in leads from WhatsApp exports, Facebook downloads or your own sheets. A phone number already in the CRM
        is added to that card, not duplicated. Rows marked lost need a lost reason. Imported leads are not messaged
        automatically.
      </p>
      <ImportForm />
    </div>
  );
}
