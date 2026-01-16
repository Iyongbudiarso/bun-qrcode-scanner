import { Jimp } from 'jimp';
import QrCode from 'qrcode-reader';

const handler = async (req: Request): Promise<Response> => {
    if (req.method === 'POST') {
      const allowedTokens = ((process.env.ACCESS_TOKENS || Bun.env.ACCESS_TOKENS) || '').split(',').filter(Boolean);
      const authHeader = req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.headers.get('x-access-token');

      if (!token || !allowedTokens.includes(token)) {
        return Response.json({ errorMessage: "Unauthorized" }, { status: 401 });
      }

      try {
        // Assuming the request body is form data with a 'file' field
        const formData = await req.formData();
        const file = formData.get('file');

        if (!file || !(file instanceof Blob)) {
          return Response.json({errorMessage: "No file uploaded or invalid file type." }, { status: 400 });
        }

        // Read the image file buffer
        const buffer = await file.arrayBuffer();

        // Process the image with Jimp
        const img = await Jimp.read(Buffer.from(buffer));
        const qr = new QrCode();

        // Use a callback function for the qrcode-reader decode method
        const value = await new Promise((resolve, reject) => {
          qr.callback = (err: any, value: { result: unknown; }) => {
            if (err) {
              reject(err);
            } else if (value) {
              resolve(value.result);
            } else {
              reject(new Error("QR code not found or could not be decoded."));
            }
          };
          qr.decode(img.bitmap);
        });

        return Response.json({
          qrcode: value,
        })

      } catch (error: any) {
        console.error(error);
        return Response.json({ errorMessage: `${error.message}` }, {
          status: 500
        });
      }
    }

    // Simple HTML form for uploading an image (client-side)
    return new Response(`
      <h1>Upload an image to read a QR code (Bun Server-Side)</h1>
      <form action="/" method="post" enctype="multipart/form-data">
        <input type="file" name="file" accept="image/*" />
        <button type="submit">Decode QR Code</button>
      </form>
    `, {
      headers: { 'Content-Type': 'text/html' },
    });
};

export default handler;

if (import.meta.main) {
  Bun.serve({
    port: 3000,
    fetch: handler,
  });
  console.log('Bun server running on http://localhost:3000');
}
