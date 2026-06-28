import { GoogleGenAI } from "@google/genai";

/**
 * Robust Gemini content generation with model fallback and error handling.
 */
export async function safeGenerateContent(ai: any, params: any) {
  const baseModel = params.model || "gemini-1.5-flash";
  const modelsToTry = [
    baseModel,
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
    "gemini-1.0-pro",
    "gemini-pro"
  ];
  
  // Clean up models: remove duplicates and ensure correct format
  const uniqueModels = [...new Set(modelsToTry)].filter(m => 
    m && 
    (m.startsWith("gemini-") || m.startsWith("models/gemini-"))
  );

  let lastError: any = null;
  
  for (const modelName of uniqueModels) {
    try {
      // Try with the provided model name
      // Some environments prefer 'models/' prefix, some don't.
      // We will try both if the first fails.
      const sanitizedModelName = modelName.includes("/") ? modelName : `models/${modelName}`;
      
      return await ai.models.generateContent({
        ...params,
        model: sanitizedModelName
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

/**
 * Robust Gemini chat interaction with model fallback and error handling.
 */
export async function safeSendMessage(ai: any, params: any) {
  const baseModel = params.model || "gemini-1.5-flash";
  const modelsToTry = [
    baseModel,
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
    "gemini-1.0-pro"
  ];
  
  const uniqueModels = [...new Set(modelsToTry)].filter(m => 
    m && 
    (m.startsWith("gemini-") || m.startsWith("models/gemini-"))
  );

  let lastError: any = null;
  
  for (const modelName of uniqueModels) {
    try {
      const sanitizedModelName = modelName.includes("/") ? modelName : `models/${modelName}`;
      
      const chat = ai.chats.create({
        ...params.config,
        model: sanitizedModelName,
        history: params.history || []
      });

      const response = await chat.sendMessage({ message: params.message });
      return response;
    } catch (err: any) {
      lastError = err;
      const errMsg = err.message || "";
      console.warn(`[Gemini Chat Fallback] Model ${modelName} failed: ${errMsg.substring(0, 100)}`);

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

  throw lastError || new Error("Gemini AI integration failed: No valid models were able to respond.");
}
