import { GoogleGenAI } from "@google/genai";

/**
 * Robust Gemini content generation with model fallback and error handling.
 */
export async function safeGenerateContent(ai: any, params: any) {
  const baseModel = params.model || "gemini-3.5-flash";
  const modelsToTry = [
    baseModel,
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-flash-latest"
  ];
  
  // Clean up models: remove duplicates and ensure correct format
  const uniqueModels = [...new Set(modelsToTry)].filter(m => 
    m && 
    (m.startsWith("gemini-") || m.startsWith("models/gemini-"))
  );

  let lastError: any = null;
  
  for (const modelName of uniqueModels) {
    try {
      // The @google/genai SDK defaults to v1beta, which is what we need.
      return await ai.models.generateContent({
        ...params,
        model: modelName
      });
    } catch (err: any) {
      lastError = err;
      const errMsg = err.message || "";
      
      let errorSummary = errMsg;
      try {
        if (errMsg.includes("{")) {
          const jsonMatch = errMsg.match(/\{.*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            errorSummary = parsed.error?.message || errorSummary;
          }
        }
      } catch (e) {}

      console.warn(`[Gemini Fallback] Model ${modelName} failed: ${errorSummary}`);

      if (
        errMsg.includes("404") || 
        errMsg.includes("not found") || 
        errMsg.includes("503") || 
        errMsg.includes("UNAVAILABLE") ||
        errMsg.includes("429") ||
        errMsg.includes("RESOURCE_EXHAUSTED")
      ) {
        continue;
      }
      throw err;
    }
  }

  if (lastError) {
    let finalErrorMsg = lastError.message || "Unknown error";
    try {
      if (finalErrorMsg.includes("{")) {
        const jsonMatch = finalErrorMsg.match(/\{.*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          finalErrorMsg = parsed.error?.message || finalErrorMsg;
        }
      }
    } catch (e) {}

    const friendlyError = new Error(`Gemini AI is currently unavailable. ${finalErrorMsg}`);
    (friendlyError as any).status = lastError.status || 500;
    throw friendlyError;
  }
  throw new Error("Gemini AI integration failed: No valid models were able to respond.");
}
