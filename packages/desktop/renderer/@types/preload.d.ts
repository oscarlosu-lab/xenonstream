import { Preload } from '../main/preload'

 
declare global {
    interface Window {
        XenonStream: typeof Preload;
    }
}
 