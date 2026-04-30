use bitfun_core::util::{JS_THREADSAFE_FUNCTION, open_dialog_file};
use napi_ohos::threadsafe_function::ThreadsafeFunctionCallMode;
#[tauri::command]
pub async fn open_oh_file_dialog() -> Result<String, String> {
    open_dialog_file().await
}

#[tauri::command]
pub async fn set_theme_mode(theme: String) -> Result<(), String> {
        let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("set_theme_mode").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    function.call(Ok(theme),ThreadsafeFunctionCallMode::NonBlocking);
    Ok(())
}

#[tauri::command]
pub fn reveal_in_oh_explorer(path: String)  -> Result<(), String> {
            let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("reveal_in_explorer").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    function.call(Ok(path),ThreadsafeFunctionCallMode::NonBlocking);
    Ok(())
}