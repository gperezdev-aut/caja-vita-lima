import "./globals.css";

export const metadata = {
  title: "Caja Vita Lima",
  description: "Dashboard interno de Caja Vita Lima",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
