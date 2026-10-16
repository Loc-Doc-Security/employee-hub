import { PRODUCT_NAME } from "../lib/brand";
import { useApp } from "../context/AppContext";

export default function HomePage() {
  const { currentUser } = useApp();
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">{PRODUCT_NAME}</h1>
      <div className="glass-card rounded-2xl p-8">
        <p className="text-sm text-slate-600">
          Signed in as {currentUser?.name}. Build your {PRODUCT_NAME} features here using the LocDoc
          theme and layout standards.
        </p>
      </div>
    </div>
  );
}
