export interface ServiceInterface<T extends Record<string, any>> {
    initialize (
        config : ComplexConfig
    ) : Promise<void>;

    getData<K extends keyof T>(
        id       : string,
        fields ? : K[]
    ) : Promise<Pick<T, K>>;

    updateData<K extends keyof T>(
        id        : string,
        data      : Partial<Pick<T, K>>,
        options ? : {
            validate : boolean;
            atomic   : boolean;
        }
    ) : Promise<T>;

    batchProcess<R>(
        items     : T[],
        processor : (
            item  : T,
            index : number
        ) => Promise<R>
    ) : Promise<R[]>;
}