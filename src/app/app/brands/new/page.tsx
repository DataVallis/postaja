import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOrgPage } from "@/server/auth/require";
import { NewBrandForm } from "../forms";

export default async function NewBrandPage() {
  const { org } = await requireOrgPage();
  if (org.role !== "owner") notFound();
  const t = await getTranslations("Brands");
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">{t("new")}</h1>
      <NewBrandForm />
    </div>
  );
}
