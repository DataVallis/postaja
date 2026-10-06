import { getTranslations } from "next-intl/server";
import { requireSuperadmin } from "@/server/admin/guard";
import { CreateOrgForm } from "../../forms";

export default async function NewOrgPage() {
  await requireSuperadmin();
  const t = await getTranslations("Admin");
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">{t("newOrg")}</h1>
      <CreateOrgForm />
    </div>
  );
}
