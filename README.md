# ⚡ FitDespensa

Inventario fitness del hogar con **fotos en el catálogo**, **control de macros**, **registro diario de comidas** y **Coach IA con Gemini**.

## Qué incluye
- **🏋️ Panel fitness:** anillos de progreso de proteína y calorías de hoy, días de proteína disponibles en tu despensa, alertas de reposición y tus mejores fuentes de proteína en stock.
- **📦 Catálogo con fotos:** toma fotos desde la cámara (nativa en celular o webcam en computadora) o elige de la galería. Las fotos se comprimen automáticamente (~30 KB, JPEG cuadrado) y se guardan junto a cada producto.
- **✨ Escáner con IA:** sube o toma foto de un alimento o tabla nutrimental y deja que Gemini rellene nombre, categoría, unidad y macros.
- **🥗 Registro diario de comidas:** lleva tus comidas por momento del día y descuenta automáticamente las porciones de tu despensa.
- **🛒 Lista de compras automática:** todo producto que baje de su mínimo aparece listo para copiar o mandar por WhatsApp.
- **🤖 Coach IA (Gemini):** conversa con el agente usando tu inventario real y tu diario de hoy. Puede sugerir comidas, registrar lo que comiste o actualizar cantidades con tarjetas de **Deshacer**.

## Cómo usarla en local
```powershell
python -m http.server 5173
```
Abre `http://localhost:5173` en tu navegador.

> **Nota sobre la cámara en celular:** los navegadores móviles solo permiten acceso a la cámara en sitios **HTTPS** o `localhost`. Para usarla desde tu teléfono en red local necesitarás publicarla (por ejemplo en Firebase Hosting) o usar un túnel HTTPS.

## Configurar el Coach IA (Gemini)
1. Consigue una API key gratuita en [Google AI Studio](https://aistudio.google.com/apikey).
2. En la app, abre **⚙️ Ajustes → Coach IA (API de Gemini)**.
3. Pega tu clave (se guarda solo en tu navegador) y guarda.

## Sincronización en la nube (opcional con Firebase)
Mientras `firebase-config.js` tenga valores de ejemplo, la app guarda todo localmente en **IndexedDB** (soporta fotos y migra datos anteriores automáticamente).

Para sincronizar entre dispositivos:
1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Activa **Authentication → Sign-in method → Anonymous** y **Firestore Database**.
3. Copia tu configuración web en `firebase-config.js`.
4. Comparte el **Código de hogar** (en ⚙️ Ajustes) en tus otros dispositivos.
