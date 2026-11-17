import { requirePermission } from "@/lib/auth/session";
import { ImportForm } from "./form";

export default async function ImportPage() {
  await requirePermission("leads.import");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="page-title">Import existing leads</h1>
      <p className="text-sm text-muted">
        Bring in leads from WhatsApp exports, Facebook downloads or your own sheets. A phone number already in the CRM
        is added to that card, not duplicated. Rows marked lost need a lost reason. Imported leads are not messaged
        automatically.
      </p>
      <ImportForm />
    </div>
  );
}
